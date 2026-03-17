import { mkdirSync } from "node:fs";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import { connect, disconnectBrowser } from "../core/browser.js";
import { getSessionSnapshotRunDir } from "../core/context.js";
import { condenseDom } from "../../shared/condense-dom/condense-dom.js";
import { readSessionState } from "../core/session.js";
import {
  type InterpretArgs,
  type ScreenshotPair,
} from "../core/snapshot-analyzer.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  loadSessionStateMiddleware,
  pageOption,
  resolveSessionMiddleware,
  sessionOption,
} from "./shared.js";
import { runApiInterpret } from "../core/api-snapshot-analyzer.js";
import { readAiConfig } from "../core/ai-config.js";
import { resolveSnapshotApiModelOrThrow } from "../core/snapshot-api-config.js";

const DEFAULT_SNAPSHOT_CONTEXT = "No additional user context provided.";
const FALLBACK_SNAPSHOT_VIEWPORT = { width: 1280, height: 800 } as const;

function generateSnapshotRunId(): string {
  return `snapshot-${Date.now()}`;
}

type SnapshotViewportMetrics = {
  configuredWidth: number | null;
  configuredHeight: number | null;
  innerWidth: number | null;
  innerHeight: number | null;
};

function isZeroViewport(value: number | null): boolean {
  return typeof value === "number" && value <= 0;
}

function shouldForceSnapshotViewport(metrics: SnapshotViewportMetrics): boolean {
  return (
    isZeroViewport(metrics.configuredWidth)
    || isZeroViewport(metrics.configuredHeight)
    || isZeroViewport(metrics.innerWidth)
    || isZeroViewport(metrics.innerHeight)
  );
}

function isZeroWidthScreenshotError(error: unknown): boolean {
  return (
    error instanceof Error
    && error.message.includes("Cannot take screenshot with 0 width")
  );
}

async function readSnapshotViewportMetrics(
  page: {
    viewportSize(): { width: number; height: number } | null;
    evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  },
): Promise<SnapshotViewportMetrics> {
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

function resolveSnapshotViewport(
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

async function forceSnapshotViewport(
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

async function captureScreenshot(
  session: string,
  logger: LoggerApi,
  pageId?: string,
): Promise<ScreenshotPair> {
  logger.info("screenshot-start", { session, pageId });
  const snapshotRunId = generateSnapshotRunId();
  const snapshotRunDir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(snapshotRunDir, { recursive: true });
  const { browser, page } = await connect(session, logger, 10000, {
    pageId,
    requireSinglePage: true,
  });

  try {
    let title: string | null = null;
    try {
      title = await page.title();
    } catch (error) {
      logger.warn("screenshot-title-read-failed", {
        session,
        pageId,
        error,
      });
    }

    let pageUrl: string | null = null;
    try {
      pageUrl = page.url();
    } catch (error) {
      logger.warn("screenshot-url-read-failed", {
        session,
        pageId,
        error,
      });
    }

    const pngPath = `${snapshotRunDir}/page.png`;
    const htmlPath = `${snapshotRunDir}/page.html`;
    const condensedHtmlPath = `${snapshotRunDir}/page.condensed.html`;

    const restoreViewport = resolveSnapshotViewport(session, logger);
    const viewportMetrics = await readSnapshotViewportMetrics(page);
    logger.info("screenshot-viewport-metrics", {
      session,
      pageId,
      restoreViewport,
      ...viewportMetrics,
    });
    await forceSnapshotViewport(
      page,
      restoreViewport,
      logger,
      session,
      pageId,
      shouldForceSnapshotViewport(viewportMetrics)
        ? "preflight-invalid-viewport"
        : "preflight-normalize-viewport",
    );

    try {
      await page.screenshot({ path: pngPath });
    } catch (error) {
      if (!isZeroWidthScreenshotError(error)) {
        throw error;
      }
      await forceSnapshotViewport(
        page,
        restoreViewport,
        logger,
        session,
        pageId,
        "retry-after-zero-width-screenshot-error",
      );
      await page.screenshot({ path: pngPath });
    }

    const htmlContent = await page.content();
    const fs = await import("node:fs/promises");
    await fs.writeFile(htmlPath, htmlContent);

    // Write condensed DOM
    const condenseResult = condenseDom(htmlContent);
    await fs.writeFile(condensedHtmlPath, condenseResult.html);

    logger.info("screenshot-success", {
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
  } catch (err) {
    let pageAlive = false;
    let browserConnected = false;
    try {
      browserConnected = browser.isConnected();
      pageAlive = !page.isClosed();
    } catch {}
    logger.error("screenshot-error", {
      error: err,
      session,
      pageAlive,
      browserConnected,
      pageUrl: (() => {
        try {
          return page.url();
        } catch {
          return null;
        }
      })(),
    });
    throw err;
  } finally {
    disconnectBrowser(browser, logger, session);
  }
}

async function runSnapshot(
  session: string,
  logger: LoggerApi,
  pageId?: string,
  objective?: string,
  context?: string,
): Promise<void> {
  const normalizedObjective = objective?.trim();
  const normalizedContext = context?.trim();
  if (!normalizedObjective && normalizedContext) {
    throw new Error(
      "Couldn't run analysis: --objective is required when providing --context.",
    );
  }

  const configuredAi = normalizedObjective ? readAiConfig() : null;
  if (normalizedObjective) {
    resolveSnapshotApiModelOrThrow(configuredAi);
  }

  const { pngPath, htmlPath, condensedHtmlPath } = await captureScreenshot(
    session,
    logger,
    pageId,
  );

  console.log("Screenshot saved:");
  console.log(`  PNG:             ${pngPath}`);
  console.log(`  HTML:            ${htmlPath}`);
  console.log(`  Condensed HTML:  ${condensedHtmlPath}`);

  if (!normalizedObjective) {
    console.log("Use --objective flag to analyze snapshots.");
    return;
  }

  const interpretArgs: InterpretArgs = {
    objective: normalizedObjective,
    session,
    context: normalizedContext ?? DEFAULT_SNAPSHOT_CONTEXT,
    pngPath,
    htmlPath,
    condensedHtmlPath,
  };

  // Analysis uses direct API calls via the Vercel AI SDK (see api-snapshot-analyzer.ts).
  // The legacy CLI-agent path (spawning codex/claude/gemini as a subprocess) is preserved
  // in snapshot-analyzer.ts — to switch back, replace this call with:
  //   await runInterpret(interpretArgs, logger);
  await runApiInterpret(interpretArgs, logger, configuredAi);
}

export const snapshotInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
    page: pageOption(),
    objective: SimpleCLI.option(z.string().optional()),
    context: SimpleCLI.option(z.string().optional()),
  },
});

export function createSnapshotCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Capture PNG + HTML; analyze when --objective is provided (--context optional)",
  })
    .input(snapshotInput)
    .use(resolveSessionMiddleware)
    .use(loadSessionStateMiddleware)
    .handle(async ({ input, ctx }) => {
      await runSnapshot(
        ctx.session,
        logger,
        input.page,
        input.objective,
        input.context,
      );
    });
}
