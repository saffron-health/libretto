import { mkdirSync } from "node:fs";
import type { Argv } from "yargs";
import type { LoggerApi } from "../../shared/logger/index.js";
import { connect, disconnectBrowser } from "../core/browser.js";
import { getSessionSnapshotRunDir } from "../core/context.js";
import { condenseDom } from "../core/condense-dom.js";
import { runApiInterpret } from "../core/api-snapshot-analyzer.js";

const DEFAULT_SNAPSHOT_CONTEXT = "No additional user context provided.";

function generateSnapshotRunId(): string {
  return `api-snapshot-${Date.now()}`;
}

async function runApiSnapshot(
  session: string,
  logger: LoggerApi,
  pageId?: string,
  objective?: string,
  context?: string,
): Promise<void> {
  logger.info("api-snapshot-start", { session, pageId });
  const snapshotRunId = generateSnapshotRunId();
  const snapshotRunDir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(snapshotRunDir, { recursive: true });

  const { browser, page } = await connect(session, logger, 10000, {
    pageId,
    requireSinglePage: true,
  });

  let pngPath: string;
  let htmlPath: string;
  let condensedHtmlPath: string;

  try {
    const title = await page.title();
    const pageUrl = page.url();
    pngPath = `${snapshotRunDir}/page.png`;
    htmlPath = `${snapshotRunDir}/page.html`;
    condensedHtmlPath = `${snapshotRunDir}/page.condensed.html`;

    await page.screenshot({ path: pngPath });

    const htmlContent = await page.content();
    const fs = await import("node:fs/promises");
    await fs.writeFile(htmlPath, htmlContent);

    const condenseResult = condenseDom(htmlContent);
    await fs.writeFile(condensedHtmlPath, condenseResult.html);

    logger.info("api-snapshot-captured", {
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
  } catch (err) {
    let pageAlive = false;
    let browserConnected = false;
    try {
      browserConnected = browser.isConnected();
      pageAlive = !page.isClosed();
    } catch {}
    logger.error("api-snapshot-capture-error", {
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

  console.log("Snapshot saved:");
  console.log(`  PNG:              ${pngPath}`);
  console.log(`  HTML:             ${htmlPath}`);
  console.log(`  Condensed HTML:   ${condensedHtmlPath}`);

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

  await runApiInterpret(
    {
      objective: normalizedObjective,
      session,
      context: normalizedContext ?? DEFAULT_SNAPSHOT_CONTEXT,
      pngPath,
      htmlPath,
      condensedHtmlPath,
    },
    logger,
  );
}

export function registerApiSnapshotCommands(
  yargs: Argv,
  logger: LoggerApi,
): Argv {
  return yargs.command(
    "api-snapshot",
    "Capture PNG + HTML; analyze via direct API call when --objective is provided (--context optional)",
    (cmd) =>
      cmd
        .option("page", { type: "string" })
        .option("objective", { type: "string" })
        .option("context", { type: "string" }),
    async (argv) => {
      await runApiSnapshot(
        String(argv.session),
        logger,
        argv.page ? String(argv.page) : undefined,
        argv.objective as string | undefined,
        argv.context as string | undefined,
      );
    },
  );
}
