import type { Argv } from "yargs";
import { runClose, runOpen, runSave } from "../core/browser";

export function registerBrowserCommands(yargs: Argv): Argv {
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
        await runOpen(url, headed, String(argv.session));
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
        await runSave(urlOrDomain, String(argv.session));
      },
    )
    .command("close", "Close the browser", (cmd) => cmd, async (argv) => {
      await runClose(String(argv.session));
    });
}

export { runClose } from "../core/browser";
