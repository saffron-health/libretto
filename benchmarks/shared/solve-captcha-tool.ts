import {
  createSdkMcpServer,
  tool,
  type HookCallbackMatcher,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { connect, disconnectBrowser } from "../../src/cli/core/browser.js";
import {
  closeLogger,
  createLoggerForSession,
} from "../../src/cli/core/context.js";
import { readSessionStateOrThrow } from "../../src/cli/core/session.js";
import { isKernelSessionState } from "../../src/shared/state/index.js";

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const SOLVE_CAPTCHA_TOOL_SERVER_NAME = "libretto-benchmark-tools";

export const SOLVE_CAPTCHA_TOOL_NAME = "solve-captcha";

type CaptchaPage = {
  url(): string;
  title(): Promise<string>;
  waitForTimeout?(timeoutMs: number): Promise<void>;
};

type CaptchaSnapshot = {
  url: string;
  title: string;
  hostname: string | null;
};

export type CaptchaWaitInput = {
  session: string;
  waitForUrlIncludes?: string;
  waitForTitleIncludes?: string;
  waitForHostname?: string;
  timeoutSeconds?: number;
};

export type CaptchaWaitResult = {
  waitedMs: number;
  snapshot: CaptchaSnapshot;
};

function normalizeMatchValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeWaitInput(input: CaptchaWaitInput): Required<CaptchaWaitInput> {
  return {
    session: input.session.trim(),
    waitForUrlIncludes: input.waitForUrlIncludes?.trim() ?? "",
    waitForTitleIncludes: input.waitForTitleIncludes?.trim() ?? "",
    waitForHostname: input.waitForHostname?.trim() ?? "",
    timeoutSeconds: input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
  };
}

function formatWaitTarget(input: Required<CaptchaWaitInput>): string {
  const parts = [
    input.waitForUrlIncludes
      ? `url contains "${input.waitForUrlIncludes}"`
      : null,
    input.waitForTitleIncludes
      ? `title contains "${input.waitForTitleIncludes}"`
      : null,
    input.waitForHostname ? `hostname is "${input.waitForHostname}"` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function assertWaitTarget(input: Required<CaptchaWaitInput>): void {
  if (!input.session) {
    throw new Error("solve-captcha requires a non-empty session name.");
  }

  if (!input.waitForUrlIncludes && !input.waitForTitleIncludes) {
    throw new Error(
      "solve-captcha requires waitForUrlIncludes or waitForTitleIncludes so it knows what page to wait for.",
    );
  }

  if (
    !Number.isFinite(input.timeoutSeconds)
    || input.timeoutSeconds <= 0
    || input.timeoutSeconds > DEFAULT_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `solve-captcha timeoutSeconds must be between 1 and ${DEFAULT_TIMEOUT_SECONDS}.`,
    );
  }
}

async function readSnapshot(page: CaptchaPage): Promise<CaptchaSnapshot> {
  const url = page.url();
  const title = await page.title();
  let hostname: string | null = null;

  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = null;
  }

  return { url, title, hostname };
}

function matchesWaitTarget(
  snapshot: CaptchaSnapshot,
  input: Required<CaptchaWaitInput>,
): boolean {
  const urlMatch = normalizeMatchValue(input.waitForUrlIncludes);
  const titleMatch = normalizeMatchValue(input.waitForTitleIncludes);
  const hostnameMatch = normalizeMatchValue(input.waitForHostname);
  const currentUrl = normalizeMatchValue(snapshot.url) ?? "";
  const currentTitle = normalizeMatchValue(snapshot.title) ?? "";
  const currentHostname = normalizeMatchValue(snapshot.hostname ?? undefined);

  if (urlMatch && !currentUrl.includes(urlMatch)) {
    return false;
  }

  if (titleMatch && !currentTitle.includes(titleMatch)) {
    return false;
  }

  if (hostnameMatch && currentHostname !== hostnameMatch) {
    return false;
  }

  return true;
}

async function sleep(page: CaptchaPage, timeoutMs: number): Promise<void> {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(timeoutMs);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export async function waitForSolveCaptchaTarget(
  page: CaptchaPage,
  input: CaptchaWaitInput,
): Promise<CaptchaWaitResult> {
  const normalized = normalizeWaitInput(input);
  assertWaitTarget(normalized);

  const startedAt = Date.now();
  const timeoutMs = normalized.timeoutSeconds * 1_000;
  let snapshot = await readSnapshot(page);

  while (true) {
    if (matchesWaitTarget(snapshot, normalized)) {
      return {
        waitedMs: Date.now() - startedAt,
        snapshot,
      };
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      break;
    }

    await sleep(page, Math.min(DEFAULT_POLL_INTERVAL_MS, remainingMs));
    snapshot = await readSnapshot(page);
  }

  throw new Error(
    [
      `Stuck on Captcha after ${normalized.timeoutSeconds}s.`,
      `Still waiting for ${formatWaitTarget(normalized)}.`,
      `Current page: ${snapshot.title || "n/a"} | ${snapshot.url || "n/a"}`,
    ].join(" "),
  );
}

export function createSolveCaptchaTool() {
  return tool(
    SOLVE_CAPTCHA_TOOL_NAME,
    "Wait for Kernel to auto-resolve a visible CAPTCHA or Cloudflare challenge in the current Libretto benchmark session. Use this instead of clicking the challenge UI yourself.",
    {
      session: z.string().trim().min(1),
      waitForUrlIncludes: z.string().trim().optional(),
      waitForTitleIncludes: z.string().trim().optional(),
      waitForHostname: z.string().trim().optional(),
      timeoutSeconds: z.number().int().min(1).max(DEFAULT_TIMEOUT_SECONDS).optional(),
    },
    async (input) => {
      const logger = createLoggerForSession(input.session);
      try {
        const sessionState = readSessionStateOrThrow(input.session);

        if (!isKernelSessionState(sessionState)) {
          throw new Error(
            "solve-captcha only supports Kernel-backed benchmark sessions.",
          );
        }

        const { browser, page } = await connect(input.session, logger, 10_000, {
          requireSinglePage: true,
        });

        try {
          const result = await waitForSolveCaptchaTarget(page, input);
          return {
            content: [
              {
                type: "text",
                text: [
                  "<system-message>Bypassed captcha</system-message>",
                  `Ready after ${Math.round(result.waitedMs / 1000)}s.`,
                  `Current page: ${result.snapshot.title} | ${result.snapshot.url}`,
                ].join("\n"),
              },
            ],
          };
        } finally {
          disconnectBrowser(browser, logger, input.session);
        }
      } finally {
        await closeLogger(logger);
      }
    },
  );
}

export function createSolveCaptchaMcpServer(): Record<string, McpServerConfig> {
  return {
    [SOLVE_CAPTCHA_TOOL_SERVER_NAME]: createSdkMcpServer({
      name: SOLVE_CAPTCHA_TOOL_SERVER_NAME,
      tools: [createSolveCaptchaTool()],
    }),
  };
}

export function createSolveCaptchaHooks(): {
  PostToolUseFailure: HookCallbackMatcher[];
} {
  return {
    PostToolUseFailure: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUseFailure") {
              return {};
            }

            if (input.tool_name !== SOLVE_CAPTCHA_TOOL_NAME) {
              return {};
            }

            if (!input.error.includes("Stuck on Captcha")) {
              return {};
            }

            return {
              continue: false,
              stopReason: "Stuck on Captcha",
              systemMessage: "<system-message>Stuck on Captcha</system-message>",
            };
          },
        ],
      },
    ],
  };
}
