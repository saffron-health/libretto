import { mkdirSync } from "node:fs";
import type { Argv } from "yargs";
import { connect, disconnectBrowser } from "../core/browser";
import { getLog, getSessionSnapshotRunDir } from "../core/context";
import { generateRunId } from "../core/session";
import {
  canAnalyzeSnapshots,
  runInterpret,
  type ScreenshotPair,
} from "../core/snapshot-analyzer";

async function captureScreenshot(session: string): Promise<ScreenshotPair> {
  const log = getLog();
  log.info("screenshot-start", { session });
  const snapshotRunId = `snapshot-${generateRunId()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const snapshotRunDir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(snapshotRunDir, { recursive: true });
  const { browser, page } = await connect(session);

  try {
    const title = await page.title();
    const pageUrl = page.url();
    const pngPath = `${snapshotRunDir}/page.png`;
    const htmlPath = `${snapshotRunDir}/page.html`;

    await page.screenshot({ path: pngPath });

    const htmlContent = await page.content();
    const fs = await import("node:fs/promises");
    await fs.writeFile(htmlPath, htmlContent);

    log.info("screenshot-success", {
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
    log.error("screenshot-error", {
      error: err,
      session,
      pageAlive,
      browserConnected,
      pageUrl: page.url(),
    });
    throw err;
  } finally {
    disconnectBrowser(browser, session);
  }
}

async function runSnapshot(
  session: string,
  objective?: string,
  context?: string,
): Promise<void> {
  const { pngPath, htmlPath } = await captureScreenshot(session);

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

  if (!normalizedContext) {
    throw new Error(
      "Couldn't run analysis: --context is required when using --objective.",
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
    context: normalizedContext,
    pngPath,
    htmlPath,
  });
}

export function registerSnapshotCommands(yargs: Argv): Argv {
  return yargs.command(
    "snapshot",
    "Capture PNG + HTML; analyze when objective/context provided",
    (cmd) =>
      cmd
        .option("objective", { type: "string" })
        .option("context", { type: "string" }),
    async (argv) => {
      await runSnapshot(
        String(argv.session),
        argv.objective as string | undefined,
        argv.context as string | undefined,
      );
    },
  );
}
