import type { Page } from "playwright";
import {
  type MinimalLogger,
  defaultLogger,
} from "../../shared/logger/logger.js";
import { generateObject, type LanguageModel } from "ai";

export type BrowserAction =
  | { type: "click"; x: number; y: number; button?: string }
  | { type: "double_click"; x: number; y: number }
  | {
      type: "scroll";
      x: number;
      y: number;
      scroll_x: number;
      scroll_y: number;
    }
  | { type: "keypress"; keys: string[] }
  | { type: "type"; text: string }
  | { type: "wait" }
  | { type: "screenshot" }
  | { type: "drag"; path: { x: number; y: number }[] }
  | { type: "move"; x: number; y: number }
  | { type: "done" };

export type RecoveryAgentStep = {
  step: number;
  reasoning: string;
  action: BrowserAction;
};

export type RecoveryAgentResult = {
  popupDetected: boolean;
  popupClosed: boolean;
  steps: RecoveryAgentStep[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KEY_MAPPINGS: Record<string, string> = {
  ENTER: "Enter",
  RETURN: "Enter",
  TAB: "Tab",
  SPACE: " ",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
  ESCAPE: "Escape",
  ESC: "Escape",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  CTRL: "Control",
  CONTROL: "Control",
  ALT: "Alt",
  SHIFT: "Shift",
  META: "Meta",
  CMD: "Meta",
  COMMAND: "Meta",
};

function mapKeyName(key: string): string {
  return KEY_MAPPINGS[key.toUpperCase()] ?? key;
}

async function executeBrowserAction(
  page: Page,
  action: BrowserAction,
  logger: MinimalLogger = defaultLogger,
): Promise<void> {
  switch (action.type) {
    case "click": {
      const { x, y, button = "left" } = action;
      const playwrightButton =
        button === "wheel" || button === "back" || button === "forward"
          ? ("left" as const)
          : (button as "left" | "right" | "middle");
      await page.mouse.click(x, y, { button: playwrightButton });
      logger.info(`Clicked at (${x}, ${y}) with ${button} button`);
      break;
    }
    case "double_click": {
      const { x, y } = action;
      await page.mouse.dblclick(x, y);
      logger.info(`Double-clicked at (${x}, ${y})`);
      break;
    }
    case "scroll": {
      const { x, y, scroll_x, scroll_y } = action;
      await page.mouse.move(x, y);
      await page.evaluate(`window.scrollBy(${scroll_x}, ${scroll_y})`);
      logger.info(`Scrolled at (${x}, ${y}) by (${scroll_x}, ${scroll_y})`);
      break;
    }
    case "keypress": {
      for (const key of action.keys) {
        const mapped = mapKeyName(key);
        await page.keyboard.press(mapped);
        logger.info(`Pressed key: ${key} (mapped to ${mapped})`);
      }
      break;
    }
    case "type": {
      await page.keyboard.type(action.text);
      logger.info(`Typed text: ${action.text}`);
      break;
    }
    case "wait": {
      await delay(2000);
      logger.info("Waited 2 seconds");
      break;
    }
    case "screenshot": {
      logger.info("Screenshot action (no-op, taken automatically)");
      break;
    }
    case "drag": {
      const { path } = action;
      const start = path[0];
      const end = path[path.length - 1];
      if (path.length >= 2 && start && end) {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let i = 1; i < path.length; i++) {
          const point = path[i];
          if (point) await page.mouse.move(point.x, point.y);
        }
        await page.mouse.up();
        logger.info(
          `Dragged from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`,
        );
      }
      break;
    }
    case "move": {
      const { x, y } = action;
      await page.mouse.move(x, y);
      logger.info(`Moved mouse to (${x}, ${y})`);
      break;
    }
    case "done": {
      break;
    }
  }
}

import { z } from "zod";

const recoveryActionSchema = z.object({
  reasoning: z
    .string()
    .describe("Your reasoning about what you see and what action to take"),
  action: z.object({
    type: z
      .enum(["click", "type", "keypress", "scroll", "wait", "done"])
      .describe("The browser action to execute."),
    x: z.number().nullable().describe("The x coordinate for click/scroll."),
    y: z.number().nullable().describe("The y coordinate for click/scroll."),
    text: z.string().nullable().describe("Text for type actions."),
    keys: z
      .array(z.string())
      .nullable()
      .describe("Keys for keypress actions."),
    scroll_x: z.number().nullable().describe("Horizontal scroll delta."),
    scroll_y: z.number().nullable().describe("Vertical scroll delta."),
  }),
});

function numberOrThrow(value: number | null, field: string): number {
  if (typeof value === "number") return value;
  throw new Error(`Recovery action is missing ${field}.`);
}

function normalizeRecoveryAction(
  action: z.infer<typeof recoveryActionSchema>["action"],
): BrowserAction {
  switch (action.type) {
    case "click":
      return {
        type: "click",
        x: numberOrThrow(action.x, "x"),
        y: numberOrThrow(action.y, "y"),
      };
    case "type":
      return { type: "type", text: action.text ?? "" };
    case "keypress":
      return { type: "keypress", keys: action.keys ?? [] };
    case "scroll":
      return {
        type: "scroll",
        x: numberOrThrow(action.x, "x"),
        y: numberOrThrow(action.y, "y"),
        scroll_x: numberOrThrow(action.scroll_x, "scroll_x"),
        scroll_y: numberOrThrow(action.scroll_y, "scroll_y"),
      };
    case "wait":
      return { type: "wait" };
    case "done":
      return { type: "done" };
  }
}

/**
 * Executes a vision-based recovery agent to recover from browser automation failures.
 * Takes a screenshot, sends it to the LLM with the instruction, and executes
 * the LLM's suggested browser actions.
 */
export async function executeRecoveryAgent(
  page: Page,
  instruction: string,
  logger?: MinimalLogger,
  model?: LanguageModel,
): Promise<RecoveryAgentResult> {
  if (!model) {
    return { popupDetected: false, popupClosed: false, steps: [] };
  }
  const log = logger ?? defaultLogger;
  log.info("Executing vision-based recovery agent", { instruction });

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Viewport size not found");
  }

  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({ fullPage: false, timeout: 10000 });
  } catch (screenshotError) {
    log.warn("Failed to take screenshot for recovery agent, skipping", {
      screenshotError:
        screenshotError instanceof Error
          ? screenshotError.message
          : String(screenshotError),
    });
    throw new Error("Failed to take screenshot for recovery agent");
  }

  const maxSteps = 3;
  const steps: RecoveryAgentStep[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    const { object: result } = await generateObject({
      model,
      schema: recoveryActionSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an expert browser support agent. Your job is to resolve issues when browser automation encounters unexpected website behavior (e.g., popups blocking interaction).

Your task: ${instruction}

Viewport: ${viewport.width}x${viewport.height}px. Complete this in as few steps as possible.
Analyze the screenshot and decide what action to take. If the task is complete or no action is needed, use the "done" action type.`,
            },
            {
              type: "image",
              image: screenshot,
            },
          ],
        },
      ],
      temperature: 0,
    });

    const action = normalizeRecoveryAction(result.action);
    log.info(`Recovery step ${step}/${maxSteps}`, {
      reasoning: result.reasoning,
      action,
    });
    steps.push({
      step,
      reasoning: result.reasoning,
      action,
    });

    if (action.type === "done") {
      log.info("Recovery agent completed - no more actions needed");
      break;
    }

    await executeBrowserAction(page, action, log);
    await delay(2000);

    // Take new screenshot for next iteration
    screenshot = await page.screenshot({ fullPage: false });
  }

  log.info("Recovery agent execution completed");
  const actionSteps = steps.filter((step) => step.action.type !== "done");
  return {
    popupDetected: actionSteps.length > 0,
    popupClosed:
      actionSteps.length > 0 && steps.at(-1)?.action.type === "done",
    steps,
  };
}
