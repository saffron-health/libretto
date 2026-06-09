import { z } from "zod";
import { SessionAccessModeSchema } from "../../shared/state/index.js";
import {
  runClose as runCloseWithLogger,
  runCloseAll as runCloseAllWithLogger,
  runConnect as runConnectWithLogger,
  runOpen,
  runOpenWithProvider,
  runPages,
  runSave,
} from "../core/browser.js";
import { resolveProviderName } from "../core/providers/index.js";
import { readLibrettoConfig } from "../core/config.js";
import { createLoggerForSession } from "../core/context.js";
import {
  type SessionAccessMode,
  assertSessionAvailableForStart,
  setSessionMode,
  validateSessionName,
} from "../core/session.js";
import { warnIfLibrettoVersionsDiffer } from "../core/skill-version.js";
import { SimpleCLI } from "affordance";
import {
  type SessionContext,
  sessionOption,
  withAutoSession,
  withExperiments,
  withRequiredSession,
} from "./shared.js";

export function parseViewportArg(
  viewportArg: string | undefined,
): { width: number; height: number } | undefined {
  if (!viewportArg) return undefined;

  const match = viewportArg.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error(
      "Invalid --viewport format. Expected WIDTHxHEIGHT (e.g. 1920x1080).",
    );
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) {
    throw new Error(
      "Invalid --viewport dimensions. Width and height must be at least 1.",
    );
  }

  return { width, height };
}

function resolveRequestedSessionMode(
  readOnly: boolean | undefined,
  writeAccess: boolean | undefined,
): SessionAccessMode {
  if (readOnly) return "read-only";
  if (writeAccess) return "write-access";
  const config = readLibrettoConfig();
  return config.sessionMode ?? "write-access";
}

export const openInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("url", z.string().default("about:blank"), {
      help: "URL to open (defaults to about:blank)",
    }),
  ],
  named: {
    session: sessionOption(),
    headed: SimpleCLI.flag({ help: "Run browser in headed mode" }),
    headless: SimpleCLI.flag({ help: "Run browser in headless mode" }),
    readOnly: SimpleCLI.flag({
      name: "read-only",
      help: "Create the session in read-only mode",
    }),
    writeAccess: SimpleCLI.flag({
      name: "write-access",
      help: "Create the session in write-access mode (overrides config default)",
    }),
    authProfile: SimpleCLI.option(z.string().optional(), {
      name: "auth-profile",
      help: "Named auth profile to load before opening the browser",
    }),
    viewport: SimpleCLI.option(z.string().optional(), {
      help: "Viewport size as WIDTHxHEIGHT (e.g. 1920x1080)",
    }),
    provider: SimpleCLI.option(z.string().optional(), {
      help: "Browser provider (local, kernel, browserbase, steel)",
      aliases: ["-p"],
    }),
  },
})
  .refine(
    (input) => !(input.headed && input.headless),
    "Cannot pass both --headed and --headless.",
  )
  .refine(
    (input) => !(input.readOnly && input.writeAccess),
    "Cannot pass both --read-only and --write-access.",
  );

export const openCommand = SimpleCLI.command({
  description: "Launch browser and open URL",
})
  .input(openInput)
  .use(withAutoSession())
  .use(withExperiments<SessionContext>())
  .handle(async ({ input, ctx }) => {
    warnIfLibrettoVersionsDiffer();
    assertSessionAvailableForStart(ctx.session, ctx.logger);
    const providerName = resolveProviderName(input.provider);
    if (providerName === "local") {
      const headed = input.headed || !input.headless;
      const viewport = parseViewportArg(input.viewport);
      await runOpen(input.url, headed, ctx.session, ctx.logger, {
        viewport,
        accessMode: resolveRequestedSessionMode(
          input.readOnly,
          input.writeAccess,
        ),
        authProfileName: input.authProfile,
        experiments: ctx.experiments,
      });
    } else {
      if (input.authProfile) {
        throw new Error(
          "--auth-profile is only supported for local browser sessions. Hosted provider sessions use workflow-declared authProfile settings.",
        );
      }
      await runOpenWithProvider(
        input.url,
        providerName,
        ctx.session,
        ctx.logger,
        resolveRequestedSessionMode(input.readOnly, input.writeAccess),
        ctx.experiments,
      );
    }
  });

export const connectInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("cdpUrl", z.string().optional(), {
      help: "CDP endpoint URL (e.g. http://127.0.0.1:9222)",
    }),
  ],
  named: {
    session: sessionOption(),
    readOnly: SimpleCLI.flag({
      name: "read-only",
      help: "Create the session in read-only mode",
    }),
    writeAccess: SimpleCLI.flag({
      name: "write-access",
      help: "Create the session in write-access mode (overrides config default)",
    }),
  },
})
  .refine(
    (input) => Boolean(input.cdpUrl),
    `Usage: libretto connect <cdp-url> [--read-only|--write-access] --session <name>`,
  )
  .refine(
    (input) => !(input.readOnly && input.writeAccess),
    "Cannot pass both --read-only and --write-access.",
  );

export const connectCommand = SimpleCLI.command({
  description: "Connect to an existing Chrome DevTools Protocol (CDP) endpoint",
})
  .input(connectInput)
  .use(withAutoSession())
  .use(withExperiments<SessionContext>())
  .handle(async ({ input, ctx }) => {
    warnIfLibrettoVersionsDiffer();
    await runConnectWithLogger(
      input.cdpUrl!,
      ctx.session,
      ctx.logger,
      resolveRequestedSessionMode(input.readOnly, input.writeAccess),
      ctx.experiments,
    );
  });

export const saveInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("profileName", z.string(), {
      help: "Profile name to save",
    }),
  ],
  named: {
    session: sessionOption(),
    sites: SimpleCLI.option(z.string(), {
      help: "Comma-separated sites whose auth state should be saved",
    }),
  },
});

export const saveCommand = SimpleCLI.command({
  description: "Save current browser session",
})
  .input(saveInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    await runSave(input.profileName, ctx.session, ctx.logger, {
      sites: input.sites,
    });
  });

export const pagesInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
  },
});

export const pagesCommand = SimpleCLI.command({
  description: "List open pages in the session",
})
  .input(pagesInput)
  .use(withRequiredSession())
  .handle(async ({ ctx }) => {
    await runPages(ctx.session, ctx.logger);
  });

export const sessionModeInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("mode", SessionAccessModeSchema.optional(), {
      help: "Session mode to set",
    }),
  ],
  named: {
    session: sessionOption(),
  },
});

export const sessionModeCommand = SimpleCLI.command({
  description: "View or set the session access mode",
})
  .input(sessionModeInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    if (!input.mode) {
      console.log(`Session "${ctx.session}" mode: ${ctx.sessionState.mode}`);
      return;
    }

    const nextState = setSessionMode(ctx.session, input.mode, ctx.logger);
    console.log(`Session "${ctx.session}" mode set to ${nextState.mode}.`);
  });

export const closeInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("session", z.string().optional(), {
      help: "Session name to close",
    }),
  ],
  named: {
    session: sessionOption(),
    all: SimpleCLI.flag({
      help: "Close all tracked sessions in this workspace",
    }),
    force: SimpleCLI.flag({
      help: "Force kill sessions that ignore SIGTERM (requires --all)",
    }),
  },
}).refine(
  (input) => input.all || input.session,
  `Usage: libretto close <session>\nUsage: libretto close --all [--force]`,
);

export const closeCommand = SimpleCLI.command({
  description: "Close the browser",
})
  .input(closeInput)
  .handle(async ({ input }) => {
    if (input.force && !input.all) {
      throw new Error(`Usage: libretto close --all [--force]`);
    }
    if (input.all) {
      const logger = createLoggerForSession("cli");
      await runCloseAllWithLogger(logger, { force: input.force });
      return;
    }
    validateSessionName(input.session!);
    const logger = createLoggerForSession(input.session!);
    await runCloseWithLogger(input.session!, logger);
  });

export const browserCommands = {
  open: openCommand,
  connect: connectCommand,
  save: saveCommand,
  pages: pagesCommand,
  "session-mode": sessionModeCommand,
  close: closeCommand,
};
