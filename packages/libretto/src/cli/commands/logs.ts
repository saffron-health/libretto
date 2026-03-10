import type { Argv } from "yargs";
import { listOpenPages } from "../core/browser.js";
import { withSessionLogger } from "../core/context.js";
import {
  clearActionLog,
  clearNetworkLog,
  formatActionEntry,
  formatNetworkEntry,
  readActionLog,
  readNetworkLog,
} from "../core/telemetry.js";

async function resolvePageId(session: string, pageId?: string): Promise<string | undefined> {
  if (!pageId) return undefined;
  const pages = await withSessionLogger(session, async (logger) =>
    listOpenPages(session, logger),
  );
  const foundPage = pages.find((page) => page.id === pageId);
  if (!foundPage) {
    throw new Error(
      `Page "${pageId}" was not found in session "${session}". Run "libretto-cli pages --session ${session}" to list ids.`,
    );
  }
  return pageId;
}

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
          .option("page", { type: "string" })
          .option("clear", { type: "boolean", default: false }),
      async (argv) => {
        const session = String(argv.session);
        if (argv.clear) {
          clearNetworkLog(session);
          console.log("Network log cleared.");
          return;
        }
        const pageId = await resolvePageId(
          session,
          argv.page ? String(argv.page) : undefined,
        );

        const entries = readNetworkLog(session, {
          last: typeof argv.last === "number" ? argv.last : undefined,
          filter: argv.filter as string | undefined,
          method: argv.method as string | undefined,
          pageId,
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
          .option("page", { type: "string" })
          .option("clear", { type: "boolean", default: false }),
      async (argv) => {
        const session = String(argv.session);
        if (argv.clear) {
          clearActionLog(session);
          console.log("Action log cleared.");
          return;
        }
        const pageId = await resolvePageId(
          session,
          argv.page ? String(argv.page) : undefined,
        );

        const entries = readActionLog(session, {
          last: typeof argv.last === "number" ? argv.last : undefined,
          filter: argv.filter as string | undefined,
          action: argv.action as string | undefined,
          source: argv.source as string | undefined,
          pageId,
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
