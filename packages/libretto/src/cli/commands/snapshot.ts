import { mkdirSync } from "node:fs";
import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import { connect, disconnectBrowser } from "../core/browser.js";
import { getSessionSnapshotRunDir } from "../core/context.js";
import {
  canAnalyzeSnapshots,
  runInterpret,
  type ScreenshotPair,
} from "../core/snapshot-analyzer.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  loadSessionStateMiddleware,
  pageOption,
  resolveSessionMiddleware,
  sessionOption,
} from "./shared.js";

const DEFAULT_SNAPSHOT_CONTEXT = "No additional user context provided.";

function generateSnapshotRunId(): string {
  return `snapshot-${Date.now()}`;
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
    const title = await page.title();
    const pageUrl = page.url();
    const pngPath = `${snapshotRunDir}/page.png`;
    const htmlPath = `${snapshotRunDir}/page.html`;

    await page.screenshot({ path: pngPath });

    const htmlContent = await page.content();
    const fs = await import("node:fs/promises");
    await fs.writeFile(htmlPath, htmlContent);

    logger.info("screenshot-success", {
      session,
      pageUrl,
      title,
      pngPath,
      htmlPath,
      snapshotRunId,
    });
    return { pngPath, htmlPath, baseName: snapshotRunId };
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
      pageUrl: page.url(),
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
  const { pngPath, htmlPath } = await captureScreenshot(session, logger, pageId);

  console.log("Screenshot saved:");
  console.log(`  PNG:  ${pngPath}`);
  console.log(`  HTML: ${htmlPath}`);

  const normalizedObjective = objective?.trim();
  const normalizedContext = context?.trim();
  if (!normalizedObjective && !normalizedContext) {
    console.log("Use --objective flag to analyze snapshots.");
    return;
  }

  if (!normalizedObjective) {
    throw new Error(
      "Couldn't run analysis: --objective is required when providing --context.",
    );
  }

  if (!canAnalyzeSnapshots()) {
    throw new Error(
      "Couldn't run analysis: no AI config set. Run 'libretto-cli ai configure codex' (or claude/gemini) to enable analysis.",
    );
  }

  await runInterpret({
    objective: normalizedObjective,
    session,
    context: normalizedContext ?? DEFAULT_SNAPSHOT_CONTEXT,
    pngPath,
    htmlPath,
  }, logger);
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
