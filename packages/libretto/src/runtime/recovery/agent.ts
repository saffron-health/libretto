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

export type RecoveryAgentStatus =
  | "skipped"
  | "no-action-needed"
  | "action-taken"
  | "incomplete";

export type RecoveryAgentResult = {
  status: RecoveryAgentStatus;
  steps: RecoveryAgentStep[];
};

type ImageDimensions = {
  width: number;
  height: number;
};

type CoordinateScale = {
  scaleX: number;
  scaleY: number;
  viewportWidth: number;
  viewportHeight: number;
};

type CdpViewportMetrics = {
  clientWidth?: number;
  clientHeight?: number;
};

type CdpLayoutMetrics = {
  cssVisualViewport?: CdpViewportMetrics;
  cssLayoutViewport?: CdpViewportMetrics;
  visualViewport?: CdpViewportMetrics;
  layoutViewport?: CdpViewportMetrics;
};

type CdpScreenshot = {
  data?: string;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scalePoint(
  x: number,
  y: number,
  scale: CoordinateScale,
): { x: number; y: number } {
  return {
    x: clamp(x * scale.scaleX, 0, Math.max(scale.viewportWidth - 1, 0)),
    y: clamp(y * scale.scaleY, 0, Math.max(scale.viewportHeight - 1, 0)),
  };
}

function scaleBrowserAction(
  action: BrowserAction,
  scale: CoordinateScale,
): BrowserAction {
  switch (action.type) {
    case "click": {
      const point = scalePoint(action.x, action.y, scale);
      return { ...action, ...point };
    }
    case "double_click": {
      const point = scalePoint(action.x, action.y, scale);
      return { ...action, ...point };
    }
    case "scroll": {
      const point = scalePoint(action.x, action.y, scale);
      return {
        ...action,
        ...point,
        scroll_x: action.scroll_x * scale.scaleX,
        scroll_y: action.scroll_y * scale.scaleY,
      };
    }
    case "drag":
      return {
        ...action,
        path: action.path.map((point) => scalePoint(point.x, point.y, scale)),
      };
    case "move": {
      const point = scalePoint(action.x, action.y, scale);
      return { ...action, ...point };
    }
    case "keypress":
    case "type":
    case "wait":
    case "screenshot":
    case "done":
      return action;
  }
}

function readPngDimensions(buffer: Buffer): ImageDimensions {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Recovery screenshot is not a PNG image.");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function toPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getViewportFromLayoutMetrics(
  metrics: CdpLayoutMetrics,
): ImageDimensions | null {
  const width =
    toPositiveNumber(metrics.cssVisualViewport?.clientWidth) ??
    toPositiveNumber(metrics.cssLayoutViewport?.clientWidth) ??
    toPositiveNumber(metrics.visualViewport?.clientWidth) ??
    toPositiveNumber(metrics.layoutViewport?.clientWidth);
  const height =
    toPositiveNumber(metrics.cssVisualViewport?.clientHeight) ??
    toPositiveNumber(metrics.cssLayoutViewport?.clientHeight) ??
    toPositiveNumber(metrics.visualViewport?.clientHeight) ??
    toPositiveNumber(metrics.layoutViewport?.clientHeight);

  return width && height ? { width, height } : null;
}

async function getViewportFromPage(page: Page): Promise<ImageDimensions | null> {
  const metrics = await page.evaluate(() => ({
    visualViewportWidth: window.visualViewport?.width,
    visualViewportHeight: window.visualViewport?.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentElementClientWidth: document.documentElement?.clientWidth,
    documentElementClientHeight: document.documentElement?.clientHeight,
  }));
  const width =
    toPositiveNumber(metrics.visualViewportWidth) ??
    toPositiveNumber(metrics.innerWidth) ??
    toPositiveNumber(metrics.documentElementClientWidth);
  const height =
    toPositiveNumber(metrics.visualViewportHeight) ??
    toPositiveNumber(metrics.innerHeight) ??
    toPositiveNumber(metrics.documentElementClientHeight);

  return width && height ? { width, height } : null;
}

function screenshotState(
  screenshot: Buffer,
  viewport: ImageDimensions,
): {
  screenshot: Buffer;
  dimensions: ImageDimensions;
  scale: CoordinateScale;
} {
  const dimensions = readPngDimensions(screenshot);
  return {
    screenshot,
    dimensions,
    scale: {
      scaleX: viewport.width / dimensions.width,
      scaleY: viewport.height / dimensions.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    },
  };
}

async function takeViewportScreenshot(page: Page): Promise<{
  screenshot: Buffer;
  dimensions: ImageDimensions;
  scale: CoordinateScale;
}> {
  const viewport =
    page.viewportSize() ?? (await getViewportFromPage(page).catch(() => null));
  if (viewport) {
    try {
      const screenshot = await page.screenshot({
        fullPage: false,
        scale: "css",
        timeout: 10000,
      });
      return screenshotState(screenshot, viewport);
    } catch {
      // Fall through to CDP screenshot capture when the page is too unstable for
      // Playwright's screenshot path.
    }
  }

  const cdpClient = await page.context().newCDPSession(page);
  try {
    await cdpClient.send("Page.enable");
    const metrics = (await cdpClient.send(
      "Page.getLayoutMetrics",
    )) as CdpLayoutMetrics;
    const cdpViewport = getViewportFromLayoutMetrics(metrics);
    if (!cdpViewport) {
      throw new Error("Viewport size not found");
    }

    const response = (await cdpClient.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    })) as CdpScreenshot;
    if (!response.data) {
      throw new Error("CDP screenshot response did not include image data");
    }

    return screenshotState(Buffer.from(response.data, "base64"), cdpViewport);
  } finally {
    await cdpClient.detach().catch(() => {});
  }
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
    x: z
      .number()
      .nullable()
      .describe("The screenshot pixel x coordinate for click/scroll."),
    y: z
      .number()
      .nullable()
      .describe("The screenshot pixel y coordinate for click/scroll."),
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

function getRecoveryStatus(steps: RecoveryAgentStep[]): RecoveryAgentStatus {
  if (steps.length === 0) {
    return "skipped";
  }
  const actionSteps = steps.filter((step) => step.action.type !== "done");
  const completed = steps.at(-1)?.action.type === "done";
  if (actionSteps.length === 0 && completed) {
    return "no-action-needed";
  }
  if (completed) {
    return "action-taken";
  }
  return "incomplete";
}

// A step is one screenshot -> model decision -> browser action cycle.
// Three covers common popup flows like close/confirm/done while bounding cost.
const DEFAULT_RECOVERY_MAX_STEPS = 3;

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
  maxSteps = DEFAULT_RECOVERY_MAX_STEPS,
): Promise<RecoveryAgentResult> {
  if (!model) {
    return { status: "skipped", steps: [] };
  }
  const log = logger ?? defaultLogger;
  log.info("Executing vision-based recovery agent", { instruction });

  let screenshotState: Awaited<ReturnType<typeof takeViewportScreenshot>>;
  try {
    screenshotState = await takeViewportScreenshot(page);
  } catch (screenshotError) {
    log.warn("Failed to take screenshot for recovery agent, skipping", {
      screenshotError:
        screenshotError instanceof Error
          ? screenshotError.message
          : String(screenshotError),
    });
    throw new Error("Failed to take screenshot for recovery agent");
  }

  const steps: RecoveryAgentStep[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    const { screenshot, dimensions, scale } = screenshotState;
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

Screenshot: ${dimensions.width}x${dimensions.height}px. Coordinates must be screenshot pixel coordinates relative to the top-left corner of the screenshot. Complete this in as few steps as possible.
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

    const imageAction = normalizeRecoveryAction(result.action);
    const action = scaleBrowserAction(imageAction, scale);
    log.info(`Recovery step ${step}/${maxSteps}`, {
      reasoning: result.reasoning,
      imageAction,
      action,
      screenshot: dimensions,
      scale,
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

    if (step < maxSteps) {
      screenshotState = await takeViewportScreenshot(page);
    }
  }

  log.info("Recovery agent execution completed");
  return {
    status: getRecoveryStatus(steps),
    steps,
  };
}
