import type { Argv } from "yargs";
import { runClose, runOpen, runSave } from "../core/browser.js";
import {
  readOnlySessionError,
  readSessionState,
  setSessionPermissionMode,
  writeSessionState,
  type SessionMode,
} from "../core/session.js";

function runSessionMode(session: string, mode: SessionMode): void {
  setSessionPermissionMode(session, mode);
  const state = readSessionState(session);
  if (state) {
    writeSessionState({
      ...state,
      mode,
    });
  }
  console.log(`Session "${session}" is now ${mode}.`);
}

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
          })
          .option("allow-actions", {
            type: "boolean",
            default: false,
            hidden: true,
          }),
      async (argv) => {
        const hasHeadedFlag = Boolean(argv.headed);
        const hasHeadlessFlag = Boolean(argv.headless);
        if (hasHeadedFlag && hasHeadlessFlag) {
          throw new Error("Cannot pass both --headed and --headless.");
        }
        const allowActions = Boolean(
          argv["allow-actions"] ?? (argv as { allowActions?: boolean }).allowActions,
        );
        if (allowActions) {
          throw new Error(
            `--allow-actions is not supported for open. ${readOnlySessionError(String(argv.session))}`,
          );
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
      "session-mode [mode]",
      "Set session execution mode",
      (cmd) => cmd.positional("mode", { type: "string" }),
      async (argv) => {
        const mode = argv.mode;
        if (mode !== "read-only" && mode !== "interactive") {
          throw new Error(
            "Usage: libretto-cli session-mode <read-only|interactive> [--session <name>]",
          );
        }
        runSessionMode(String(argv.session), mode);
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

export { runClose } from "../core/browser.js";
