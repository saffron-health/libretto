import type { Argv } from "yargs";
import {
  clearActionLog,
  clearNetworkLog,
  formatActionEntry,
  formatNetworkEntry,
  readActionLog,
  readNetworkLog,
} from "../core/telemetry.js";

export function registerLogCommands(yargs: Argv): Argv {
  return yargs
    .command(
      "network",
      "View captured network requests",
      (cmd) =>
        cmd
          .option("last", { type: "number" })
          .option("filter", { type: "string" })
          .option("method", { type: "string" })
          .option("clear", { type: "boolean", default: false }),
      async (argv) => {
        if (argv.clear) {
          clearNetworkLog(String(argv.session));
          console.log("Network log cleared.");
          return;
        }

        const entries = readNetworkLog(String(argv.session), {
          last: typeof argv.last === "number" ? argv.last : undefined,
          filter: argv.filter as string | undefined,
          method: argv.method as string | undefined,
        });

        if (entries.length === 0) {
          console.log("No network requests captured.");
          return;
        }

        for (const entry of entries) {
          console.log(formatNetworkEntry(entry));
        }
        console.log(`\n${entries.length} request(s) shown.`);
      },
    )
    .command(
      "actions",
      "View captured actions",
      (cmd) =>
        cmd
          .option("last", { type: "number" })
          .option("filter", { type: "string" })
          .option("action", { type: "string" })
          .option("source", { type: "string" })
          .option("clear", { type: "boolean", default: false }),
      async (argv) => {
        if (argv.clear) {
          clearActionLog(String(argv.session));
          console.log("Action log cleared.");
          return;
        }

        const entries = readActionLog(String(argv.session), {
          last: typeof argv.last === "number" ? argv.last : undefined,
          filter: argv.filter as string | undefined,
          action: argv.action as string | undefined,
          source: argv.source as string | undefined,
        });

        if (entries.length === 0) {
          console.log("No actions captured.");
          return;
        }

        for (const entry of entries) {
          console.log(formatActionEntry(entry));
        }
        console.log(`\n${entries.length} action(s) shown.`);
      },
    );
}
