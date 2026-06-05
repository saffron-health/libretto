import { z } from "zod";
import { SimpleCLI } from "affordance";
import { createLoggerForSession } from "../core/context.js";
import { runFetchChromeProfile } from "../core/browser.js";

export const importChromeProfilesCommand = SimpleCLI.command({
  description: "Fetch scoped auth state from a Chrome CDP session into a local profile",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("profileName", z.string(), {
        help: "Profile name to save",
      }),
    ],
    named: {
      cdpUrl: SimpleCLI.option(z.string(), {
        name: "cdp-url",
        help: "Chrome DevTools Protocol endpoint for the Chrome instance",
      }),
      sites: SimpleCLI.option(z.string(), {
        help: "Comma-separated sites whose auth state should be imported",
      }),
    },
  }))
  .handle(async ({ input }) => {
    const logger = createLoggerForSession(`profile-fetch-${Date.now()}`);
    try {
      await runFetchChromeProfile(input.profileName, input.cdpUrl, logger, {
        sites: input.sites,
      });
    } finally {
      await logger.close();
    }
  });
