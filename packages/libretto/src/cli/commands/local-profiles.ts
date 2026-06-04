import { z } from "zod";
import { SimpleCLI } from "affordance";
import { createLoggerForSession } from "../core/context.js";
import { runFetchChromeProfile } from "../core/browser.js";

export const fetchChromeProfileCommand = SimpleCLI.command({
  description: "Fetch scoped auth state from a Chrome CDP session into a local profile",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("profileName", z.string().optional(), {
        help: "Profile name to save",
      }),
    ],
    named: {
      cdpUrl: SimpleCLI.option(z.string().optional(), {
        name: "cdp-url",
        help: "Chrome DevTools Protocol endpoint for the Chrome instance",
      }),
      sites: SimpleCLI.option(z.string().optional(), {
        help: "Comma-separated sites whose auth state should be imported",
      }),
    },
  }).refine(
    (input) => Boolean(input.profileName && input.cdpUrl && input.sites),
    "Usage: libretto profiles fetch chrome <profile-name> --cdp-url <url> --sites <site[,site]>",
  ))
  .handle(async ({ input }) => {
    const logger = createLoggerForSession(`profile-fetch-${Date.now()}`);
    try {
      await runFetchChromeProfile(input.profileName!, input.cdpUrl!, logger, {
        sites: input.sites!,
      });
    } finally {
      await logger.close();
    }
  });

export const localProfileCommands = SimpleCLI.group({
  description: "Manage local browser auth profiles",
  routes: {
    fetch: SimpleCLI.group({
      description: "Fetch profiles from external browsers",
      routes: {
        chrome: fetchChromeProfileCommand,
      },
    }),
  },
});
