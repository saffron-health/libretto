import { mkdirSync } from "node:fs";
import type { Argv } from "yargs";
import type { LoggerApi } from "libretto/logger";
import { connect, disconnectBrowser } from "../core/browser.js";
import { getSessionSnapshotRunDir } from "../core/context.js";
import {
  canAnalyzeSnapshots,
  runInterpret,
  type ScreenshotPair,
} from "../core/snapshot-analyzer.js";

const DEFAULT_SNAPSHOT_CONTEXT = "No additional user context provided.";

async function captureScreenshot(
  session: string,
  logger: LoggerApi,
): Promise<ScreenshotPair> {
  logger.info("screenshot-start", { session });
  const snapshotRunId = `snapshot-${Date.now()}`;
  const snapshotRunDir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(snapshotRunDir, { recursive: true });
  const { browser, page } = await connect(session, logger);

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
  objective?: string,
  context?: string,
): Promise<void> {
  const { pngPath, htmlPath } = await captureScreenshot(session, logger);

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

export function registerSnapshotCommands(yargs: Argv, logger: LoggerApi): Argv {
  return yargs.command(
    "snapshot",
    "Capture PNG + HTML; analyze when --objective is provided (--context optional)",
    (cmd) =>
      cmd
        .option("objective", { type: "string" })
        .option("context", { type: "string" }),
    async (argv) => {
      await runSnapshot(
        String(argv.session),
        logger,
        argv.objective as string | undefined,
        argv.context as string | undefined,
      );
    },
  );
}
