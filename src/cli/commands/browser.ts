import type { Argv } from "yargs";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  runClose as runCloseWithLogger,
  runCloseAll as runCloseAllWithLogger,
  runOpen,
  runPages,
  runSave,
} from "../core/browser.js";
import { withSessionLogger } from "../core/context.js";

export function registerBrowserCommands(yargs: Argv, logger: LoggerApi): Argv {
  return yargs
    .command(
      "open [url]",
      "Launch browser and open URL (headed by default)",
      (cmd) =>
        cmd
          .option("headed", {
            type: "boolean",
            default: false,
          })
          .option("headless", {
            type: "boolean",
            default: false,
          })
          .option("viewport", {
            type: "string",
            describe: "Viewport size as WIDTHxHEIGHT (e.g. 1920x1080)",
          }),
      async (argv) => {
        const hasHeadedFlag = Boolean(argv.headed);
        const hasHeadlessFlag = Boolean(argv.headless);
        if (hasHeadedFlag && hasHeadlessFlag) {
          throw new Error("Cannot pass both --headed and --headless.");
        }
        const headed = hasHeadedFlag || !hasHeadlessFlag;
        const url = argv.url as string | undefined;
        if (!url) {
          throw new Error(
            "Usage: libretto-cli open <url> [--headless] [--viewport WxH] [--session <name>]",
          );
        }
        const viewportArg = argv.viewport as string | undefined;
        let viewport: { width: number; height: number } | undefined;
        if (viewportArg) {
          const match = viewportArg.match(/^(\d+)x(\d+)$/i);
          if (!match) {
            throw new Error(
              "Invalid --viewport format. Expected WIDTHxHEIGHT (e.g. 1920x1080).",
            );
          }
          const w = Number(match[1]);
          const h = Number(match[2]);
          if (w < 1 || h < 1) {
            throw new Error(
              "Invalid --viewport dimensions. Width and height must be at least 1.",
            );
          }
          viewport = { width: w, height: h };
        }
        await runOpen(url, headed, String(argv.session), logger, { viewport });
      },
    )
    .command(
      "save [urlOrDomain]",
      "Save current browser session",
      (cmd) => cmd,
      async (argv) => {
        const urlOrDomain = argv.urlOrDomain as string | undefined;
        if (!urlOrDomain) {
          throw new Error("Usage: libretto-cli save <url|domain> [--session <name>]");
        }
        await runSave(urlOrDomain, String(argv.session), logger);
      },
    )
    .command("pages", "List open pages in the session", (cmd) => cmd, async (argv) => {
      await runPages(String(argv.session), logger);
    })
    .command(
      "close",
      "Close the browser",
      (cmd) =>
        cmd
          .option("all", {
            type: "boolean",
            default: false,
            describe: "Close all tracked sessions in this workspace",
          })
          .option("force", {
            type: "boolean",
            default: false,
            describe: "Force kill sessions that ignore SIGTERM (requires --all)",
          }),
      async (argv) => {
        const closeAll = Boolean(argv.all);
        const force = Boolean(argv.force);
        if (force && !closeAll) {
          throw new Error("Usage: libretto-cli close --all [--force]");
        }
        if (closeAll) {
          await runCloseAllWithLogger(logger, { force });
          return;
        }
        await runCloseWithLogger(String(argv.session), logger);
      },
    );
}

export async function runClose(session: string): Promise<void> {
  await withSessionLogger(session, async (logger) => {
    await runCloseWithLogger(session, logger);
  });
}
