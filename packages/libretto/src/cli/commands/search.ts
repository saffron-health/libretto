import { z } from "zod";
import { DaemonClient } from "../core/daemon/ipc.js";
import { resolveExperiments } from "../core/experiments.js";
import {
  formatHtmlForSearch,
  searchFormattedHtml,
} from "../../shared/html-search/search-html.js";
import { pageOption, sessionOption, withRequiredSession } from "./shared.js";
import { SimpleCLI } from "affordance";

export const searchInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("pattern", z.string().optional(), {
      help: "JavaScript regex pattern to search for in the formatted HTML snapshot",
    }),
  ],
  named: {
    session: sessionOption(),
    page: pageOption(),
  },
}).refine(
  (input) => input.pattern !== undefined,
  "Usage: libretto search <regex> --session <name> [--page <id>]",
);

export const searchCommand = SimpleCLI.command({
  description: "Search the current page HTML snapshot",
})
  .input(searchInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    if (!resolveExperiments().search) {
      throw new Error(
        [
          'The "search" experiment is disabled.',
          "Enable it with: libretto experiments enable search",
        ].join("\n"),
      );
    }

    if (!ctx.sessionState.daemonSocketPath) {
      throw new Error(
        `Session "${ctx.session}" has no daemon socket. Close and reopen it with: libretto open <url> --session ${ctx.session}`,
      );
    }

    const client = await DaemonClient.connect(ctx.sessionState.daemonSocketPath);
    try {
      const response = await client.readonlyExec({
        code: "return await page.content()",
        pageId: input.page,
      });
      if (!response.ok) {
        throw new Error(response.message);
      }
      if (typeof response.data.result !== "string") {
        throw new Error("Expected page.content() to return an HTML string.");
      }

      const formattedHtml = formatHtmlForSearch(response.data.result);
      const matches = searchFormattedHtml(formattedHtml, input.pattern!);
      if (matches.length === 0) {
        console.log(`No matches for /${input.pattern}/.`);
        return;
      }

      for (const [index, match] of matches.entries()) {
        if (index > 0) console.log("--");
        console.log(match.lines.join("\n"));
      }
    } finally {
      client.destroy();
    }
  });
