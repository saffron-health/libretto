import { z } from "zod";
import {
  runClose as runCloseWithLogger,
  runCloseAll as runCloseAllWithLogger,
  runConnect as runConnectWithLogger,
  runOpen,
  runPages,
  runSave,
} from "../core/browser.js";
import { createLoggerForSession, withSessionLogger } from "../core/context.js";
import {
  assertSessionAvailableForStart,
  validateSessionName,
} from "../core/session.js";
import { warnIfInstalledSkillOutOfDate } from "../core/skill-version.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  sessionOption,
  withAutoSession,
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

export const openInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("url", z.string().optional(), {
      help: "URL to open",
    }),
  ],
  named: {
    session: sessionOption(),
    headed: SimpleCLI.flag({ help: "Run browser in headed mode" }),
    headless: SimpleCLI.flag({ help: "Run browser in headless mode" }),
    viewport: SimpleCLI.option(z.string().optional(), {
      help: "Viewport size as WIDTHxHEIGHT (e.g. 1920x1080)",
    }),
  },
})
  .refine(
    (input) => Boolean(input.url),
    `Usage: libretto open <url> [--headless] [--viewport WxH] [--session <name>]`,
  )
  .refine(
    (input) => !(input.headed && input.headless),
    "Cannot pass both --headed and --headless.",
  );

export const openCommand = SimpleCLI.command({
  description: "Launch browser and open URL (headed by default)",
})
  .input(openInput)
  .use(withAutoSession())
  .handle(async ({ input, ctx }) => {
    warnIfInstalledSkillOutOfDate();
    assertSessionAvailableForStart(ctx.session, ctx.logger);
    const headed = input.headed || !input.headless;
    const viewport = parseViewportArg(input.viewport);
    await runOpen(input.url!, headed, ctx.session, ctx.logger, { viewport });
  });

export const connectInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("cdpUrl", z.string().optional(), {
      help: "CDP endpoint URL (e.g. http://127.0.0.1:9222)",
    }),
  ],
  named: {
    session: sessionOption(),
  },
}).refine(
  (input) => Boolean(input.cdpUrl),
  `Usage: libretto connect <cdp-url> --session <name>`,
);

export const connectCommand = SimpleCLI.command({
  description: "Connect to an existing Chrome DevTools Protocol (CDP) endpoint",
})
  .input(connectInput)
  .use(withAutoSession())
  .handle(async ({ input, ctx }) => {
    warnIfInstalledSkillOutOfDate();
    await runConnectWithLogger(input.cdpUrl!, ctx.session, ctx.logger);
  });

export const saveInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("urlOrDomain", z.string().optional(), {
      help: "URL or domain to save",
    }),
  ],
  named: {
    session: sessionOption(),
  },
}).refine(
  (input) => Boolean(input.urlOrDomain),
  `Usage: libretto save <url|domain> --session <name>`,
);

export const saveCommand = SimpleCLI.command({
  description: "Save current browser session",
})
  .input(saveInput)
  .use(withRequiredSession())
  .handle(async ({ input, ctx }) => {
    await runSave(input.urlOrDomain!, ctx.session, ctx.logger);
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

export const closeInput = SimpleCLI.input({
  positionals: [],
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
  `Usage: libretto close --session <name>\nUsage: libretto close --all [--force]`,
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
  close: closeCommand,
};

export async function runClose(session: string): Promise<void> {
  await withSessionLogger(session, async (logger) => {
    await runCloseWithLogger(session, logger);
  });
}
