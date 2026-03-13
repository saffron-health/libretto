import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import {
  runClose as runCloseWithLogger,
  runCloseAll as runCloseAllWithLogger,
  runOpen,
  runPages,
  runSave,
} from "../core/browser.js";
import { withSessionLogger } from "../core/context.js";
import { assertSessionAvailableForStart } from "../core/session.js";
import { SimpleCLI } from "../framework/simple-cli.js";
import {
  loadSessionStateMiddleware,
  resolveSessionMiddleware,
  sessionOption,
} from "./shared.js";

function parseViewportArg(
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
    "Usage: libretto-cli open <url> [--headless] [--viewport WxH] [--session <name>]",
  )
  .refine(
    (input) => !(input.headed && input.headless),
    "Cannot pass both --headed and --headless.",
  );

export function createOpenCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Launch browser and open URL (headed by default)",
  })
    .input(openInput)
    .use(resolveSessionMiddleware)
    .handle(async ({ input, ctx }) => {
      assertSessionAvailableForStart(ctx.session, logger);
      const headed = input.headed || !input.headless;
      const viewport = parseViewportArg(input.viewport);
      await runOpen(input.url!, headed, ctx.session, logger, { viewport });
    });
}

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
  "Usage: libretto-cli save <url|domain> [--session <name>]",
);

export function createSaveCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Save current browser session",
  })
    .input(saveInput)
    .use(resolveSessionMiddleware)
    .use(loadSessionStateMiddleware)
    .handle(async ({ input, ctx }) => {
      await runSave(input.urlOrDomain!, ctx.session, logger);
    });
}

export const pagesInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
  },
});

export function createPagesCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "List open pages in the session",
  })
    .input(pagesInput)
    .use(resolveSessionMiddleware)
    .use(loadSessionStateMiddleware)
    .handle(async ({ ctx }) => {
      await runPages(ctx.session, logger);
    });
}

export const closeInput = SimpleCLI.input({
  positionals: [],
  named: {
    session: sessionOption(),
    all: SimpleCLI.flag({ help: "Close all tracked sessions in this workspace" }),
    force: SimpleCLI.flag({ help: "Force kill sessions that ignore SIGTERM (requires --all)" }),
  },
});

export function createCloseCommand(logger: LoggerApi) {
  return SimpleCLI.command({
    description: "Close the browser",
  })
    .input(closeInput)
    .use(resolveSessionMiddleware)
    .handle(async ({ input, ctx }) => {
      if (input.force && !input.all) {
        throw new Error("Usage: libretto-cli close --all [--force]");
      }
      if (input.all) {
        await runCloseAllWithLogger(logger, { force: input.force });
        return;
      }
      await runCloseWithLogger(ctx.session, logger);
    });
}

export function createBrowserCommands(logger: LoggerApi) {
  return {
    open: createOpenCommand(logger),
    save: createSaveCommand(logger),
    pages: createPagesCommand(logger),
    close: createCloseCommand(logger),
  };
}

export async function runClose(session: string): Promise<void> {
  await withSessionLogger(session, async (logger) => {
    await runCloseWithLogger(session, logger);
  });
}
