import { z } from "zod";
import { SimpleCLI } from "affordance";
import { createLoggerForSession } from "../core/context.js";
import { runFetchChromeProfile } from "../core/browser.js";

export const fetchChromeProfileCommand = SimpleCLI.command({
  description: "Fetch auth state from a Chrome CDP session into a local profile",
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
      site: SimpleCLI.option(z.string().optional(), {
        help: "Site or domain this profile authenticates",
      }),
      account: SimpleCLI.option(z.string().optional(), {
        help: "Account label for the imported browser profile",
      }),
    },
  }).refine(
    (input) => Boolean(input.profileName && input.cdpUrl),
    "Usage: libretto profiles fetch chrome <profile-name> --cdp-url <url>",
  ))
  .handle(async ({ input }) => {
    const logger = createLoggerForSession(`profile-fetch-${Date.now()}`);
    try {
      if (input.site || input.account) {
        logger.info("fetch-chrome-profile-metadata", {
          site: input.site,
          account: input.account,
        });
      }
      await runFetchChromeProfile(input.profileName!, input.cdpUrl!, logger);
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
