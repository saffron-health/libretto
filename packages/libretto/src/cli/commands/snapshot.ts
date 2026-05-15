import { z } from "zod";
import type { LoggerApi } from "../../runtime/logger/index.js";
import { readSessionState } from "../core/session.js";
import { SimpleCLI } from "affordance";
import {
  pageOption,
  sessionOption,
  withRequiredSession,
} from "./shared.js";
import { DaemonClient } from "../core/daemon/ipc.js";
import { librettoCommand } from "../package-manager.js";
import { renderSnapshot } from "../snapshot/render-snapshot.js";

export const FALLBACK_SNAPSHOT_VIEWPORT = { width: 1280, height: 800 } as const;

type SnapshotViewportMetrics = {
  configuredWidth: number | null;
  configuredHeight: number | null;
  innerWidth: number | null;
  innerHeight: number | null;
};

export function isZeroViewport(value: number | null): boolean {
  return typeof value === "number" && value <= 0;
}

export function shouldForceSnapshotViewport(
  metrics: SnapshotViewportMetrics,
): boolean {
  return (
    isZeroViewport(metrics.configuredWidth) ||
    isZeroViewport(metrics.configuredHeight) ||
    isZeroViewport(metrics.innerWidth) ||
    isZeroViewport(metrics.innerHeight)
  );
}

export function isZeroWidthScreenshotError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Cannot take screenshot with 0 width")
  );
}

export async function readSnapshotViewportMetrics(page: {
  viewportSize(): { width: number; height: number } | null;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
}): Promise<SnapshotViewportMetrics> {
  const configuredViewport = page.viewportSize();
  let innerWidth: number | null = null;
  let innerHeight: number | null = null;

  try {
    const innerViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    innerWidth = innerViewport.width;
    innerHeight = innerViewport.height;
  } catch {}

  return {
    configuredWidth: configuredViewport?.width ?? null,
    configuredHeight: configuredViewport?.height ?? null,
    innerWidth,
    innerHeight,
  };
}

export function resolveSnapshotViewport(
  session: string,
  logger: LoggerApi,
): { width: number; height: number } {
  const state = readSessionState(session, logger);
  if (state?.viewport) {
    logger.info("screenshot-viewport-from-session-state", {
      session,
      viewport: state.viewport,
    });
    return state.viewport;
  }
  logger.info("screenshot-viewport-fallback", {
    session,
    reason: "no viewport in session state",
    viewport: FALLBACK_SNAPSHOT_VIEWPORT,
  });
  return FALLBACK_SNAPSHOT_VIEWPORT;
}

export async function forceSnapshotViewport(
  page: {
    setViewportSize(size: { width: number; height: number }): Promise<void>;
  },
  viewport: { width: number; height: number },
  logger: LoggerApi,
  session: string,
  pageId?: string,
  reason?: string,
): Promise<void> {
  await page.setViewportSize(viewport);
  logger.warn("screenshot-viewport-forced", {
    session,
    pageId,
    reason,
    viewport,
  });
}

async function runCompactSnapshot(
  args: {
    session: string;
    daemonSocketPath?: string;
    logger: LoggerApi;
    pageId?: string;
    ref?: string;
  },
): Promise<void> {
  if (!args.daemonSocketPath) {
    throw new Error(
      `Session "${args.session}" has no daemon socket. The browser daemon may have crashed. ` +
        `Close and reopen the session: ${librettoCommand(`close --session ${args.session}`)}`,
    );
  }

  args.logger.info("compact-snapshot-via-daemon", {
    session: args.session,
    pageId: args.pageId,
    ref: args.ref,
  });

  const client = await DaemonClient.connect(args.daemonSocketPath);
  let result: Awaited<ReturnType<DaemonClient["snapshot"]>>;
  try {
    result = await client.snapshot({
      pageId: args.pageId,
      useCachedSnapshot: args.ref !== undefined,
    });
  } finally {
    client.destroy();
  }
  console.log(`Screenshot at ${result.pngPath}`);
  console.log(renderSnapshot(result.snapshot, args.ref));
  console.log(
    `Hint: Use ${librettoCommand(`snapshot <ref> --session ${args.session}`)} to inspect a subtree.`,
  );
}

export const snapshotInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("ref", z.string().optional(), {
      help: "Optional element ref to scope output to that subtree (for example, l16 or e16)",
    }),
  ],
  named: {
    session: sessionOption(),
    page: pageOption(),
    objective: SimpleCLI.option(z.string().optional()),
    context: SimpleCLI.option(z.string().optional()),
  },
});

export const snapshotCommand = SimpleCLI.command({
  description: "Capture a screenshot and compact accessibility snapshot",
})
  .input(snapshotInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    await runCompactSnapshot({
      session: ctx.session,
      daemonSocketPath: ctx.sessionState.daemonSocketPath,
      logger: ctx.logger,
      pageId: input.page,
      ref: input.ref,
    });
  });
