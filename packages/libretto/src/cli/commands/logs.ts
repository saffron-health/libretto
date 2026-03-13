import { z } from "zod";
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
import { SimpleCLI } from "../framework/simple-cli.js";
import { integerOption, pageOption, sessionOption } from "./shared.js";

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

export const networkInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
    last: integerOption(),
    filter: SimpleCLI.option(z.string().optional()),
    method: SimpleCLI.option(z.string().optional()),
    page: pageOption(),
    clear: SimpleCLI.flag(),
  },
});

export const networkCommand = SimpleCLI.command({
  description: "View captured network requests",
})
  .input(networkInput)
  .handle(async ({ input }) => {
    if (input.clear) {
      clearNetworkLog(input.session);
      console.log("Network log cleared.");
      return;
    }

    const pageId = await resolvePageId(input.session, input.page);
    const entries = readNetworkLog(input.session, {
      last: input.last,
      filter: input.filter,
      method: input.method,
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
  });

export const actionsInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
    last: integerOption(),
    filter: SimpleCLI.option(z.string().optional()),
    action: SimpleCLI.option(z.string().optional()),
    source: SimpleCLI.option(z.string().optional()),
    page: pageOption(),
    clear: SimpleCLI.flag(),
  },
});

export const actionsCommand = SimpleCLI.command({
  description: "View captured actions",
})
  .input(actionsInput)
  .handle(async ({ input }) => {
    if (input.clear) {
      clearActionLog(input.session);
      console.log("Action log cleared.");
      return;
    }

    const pageId = await resolvePageId(input.session, input.page);
    const entries = readActionLog(input.session, {
      last: input.last,
      filter: input.filter,
      action: input.action,
      source: input.source,
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
  });

export const logCommands = {
  network: networkCommand,
  actions: actionsCommand,
};
