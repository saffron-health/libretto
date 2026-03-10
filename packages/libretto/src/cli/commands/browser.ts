import type { Argv } from "yargs";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  runClose as runCloseWithLogger,
  runOpen,
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
            "Usage: libretto-cli open <url> [--headless] [--session <name>]",
          );
        }
        await runOpen(url, headed, String(argv.session), logger);
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
    .command("close", "Close the browser", (cmd) => cmd, async (argv) => {
      await runCloseWithLogger(String(argv.session), logger);
    });
}

export async function runClose(session: string): Promise<void> {
  await withSessionLogger(session, async (logger) => {
    await runCloseWithLogger(session, logger);
  });
}
