import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import { condenseDom } from "../../shared/condense-dom/condense-dom.js";
import { readSessionState } from "../core/session.js";
import {
  type InterpretArgs,
  type ScreenshotPair,
} from "../core/snapshot-analyzer.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import { pageOption, sessionOption, withRequiredSession } from "./shared.js";
import { runApiInterpret } from "../core/api-snapshot-analyzer.js";
import { readSnapshotModel } from "../core/config.js";
import { resolveSnapshotApiModelOrThrow } from "../core/ai-model.js";
import { DaemonClient } from "../core/daemon/index.js";
import { runCommand } from "../core/run-command.js";

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

async function captureSnapshot(
  session: string,
  logger: LoggerApi,
  daemonSocketPath: string,
  pageId?: string,
): Promise<ScreenshotPair> {
  logger.info("snapshot-via-daemon", { session, pageId });
  const client = new DaemonClient(daemonSocketPath);
  const { pngPath, htmlPath, snapshotRunId, pageUrl, title } =
    await client.snapshot({ pageId });

  // condenseDom runs in the CLI process, not the daemon.
  const htmlContent = readFileSync(htmlPath, "utf8");
  const condenseResult = condenseDom(htmlContent);
  const condensedHtmlPath = htmlPath.replace(/\.html$/, ".condensed.html");
  writeFileSync(condensedHtmlPath, condenseResult.html);

  logger.info("snapshot-daemon-success", {
    session,
    pageUrl,
    title,
    pngPath,
    htmlPath,
    condensedHtmlPath,
    snapshotRunId,
    domCondenseStats: {
      originalLength: condenseResult.originalLength,
      condensedLength: condenseResult.condensedLength,
      reductions: condenseResult.reductions,
    },
  });

  return { pngPath, htmlPath, condensedHtmlPath, baseName: snapshotRunId };
}

async function runSnapshot(
  session: string,
  logger: LoggerApi,
  pageId: string | undefined,
  objective: string,
  context: string,
): Promise<void> {
  const normalizedObjective = objective.trim();
  const normalizedContext = context.trim();

  const snapshotModel = readSnapshotModel();
  resolveSnapshotApiModelOrThrow(snapshotModel);

  const state = readSessionState(session, logger);
  if (!state?.daemonSocketPath) {
    throw new Error(
      `Session "${session}" has no daemon socket. The browser daemon may have crashed. ` +
        `Close and reopen the session: ${runCommand(`close --session ${session}`)}`,
    );
  }

  const { pngPath, htmlPath, condensedHtmlPath } =
    await captureSnapshot(session, logger, state.daemonSocketPath, pageId);

  console.log("Screenshot saved:");
  console.log(`  PNG:             ${pngPath}`);
  console.log(`  HTML:            ${htmlPath}`);
  console.log(`  Condensed HTML:  ${condensedHtmlPath}`);

  const interpretArgs: InterpretArgs = {
    objective: normalizedObjective,
    session,
    context: normalizedContext,
    pngPath,
    htmlPath,
    condensedHtmlPath,
  };

  // Analysis uses direct API calls via the Vercel AI SDK (see api-snapshot-analyzer.ts).
  // The legacy CLI-agent path (spawning codex/claude/gemini as a subprocess) is preserved
  // in snapshot-analyzer.ts — to switch back, replace this call with:
  //   await runInterpret(interpretArgs, logger);
  await runApiInterpret(interpretArgs, logger, snapshotModel);
}

export const snapshotInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
    page: pageOption(),
    objective: SimpleCLI.option(z.string()),
    context: SimpleCLI.option(z.string()),
  },
});

export const snapshotCommand = SimpleCLI.command({
  description: "Capture PNG + HTML and analyze with --objective and --context",
})
  .input(snapshotInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    await runSnapshot(
      ctx.session,
      ctx.logger,
      input.page,
      input.objective,
      input.context,
    );
  });
