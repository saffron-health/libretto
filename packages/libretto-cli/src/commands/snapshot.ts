import { mkdirSync } from "node:fs";
import type { Argv } from "yargs";
import { connect, disconnectBrowser } from "../core/browser";
import { getLog } from "../core/context";
import { getRunDir, getSessionStateOrThrow } from "../core/session";
import {
  canAnalyzeSnapshots,
  runInterpret,
  runSnapshotConfigure,
  type ScreenshotPair,
} from "../core/snapshot-analyzer";

async function captureScreenshot(session: string): Promise<ScreenshotPair> {
  const log = getLog();
  log.info("screenshot-start", { session });
  const state = getSessionStateOrThrow(session);
  const runDir = getRunDir(state.runId);
  mkdirSync(runDir, { recursive: true });
  const { browser, page } = await connect(session);

  try {
    const title = await page.title();
    const pageUrl = page.url();
    const sanitizedTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${sanitizedTitle}-${timestamp}`;

    const pngPath = `${runDir}/${baseName}.png`;
    const htmlPath = `${runDir}/${baseName}.html`;

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
    });
    return { pngPath, htmlPath, baseName };
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
      "Couldn't run analysis: no AI config set. Run 'libretto-cli ai configure codex' (or opencode/claude/gemini) to enable analysis.",
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
  return yargs
    .command(
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
    )
    .command(
      "snapshot configure [preset]",
      "Configure AI runtime (compatibility alias for 'ai configure')",
      (cmd) => cmd.option("clear", { type: "boolean", default: false }),
      (argv) => {
        const customPrefix = Array.isArray(argv["--"])
          ? (argv["--"] as string[])
          : [];
        runSnapshotConfigure({
          clear: Boolean(argv.clear),
          preset: argv.preset as string | undefined,
          customPrefix,
        });
      },
    );
}
