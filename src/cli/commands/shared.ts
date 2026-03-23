import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import { createLoggerForSession } from "../core/context.js";
import {
  generateSessionName,
  readSessionStateOrThrow,
  type SessionState,
  validateSessionName,
} from "../core/session.js";
import {
  SimpleCLI,
  type SimpleCLIMiddleware,
} from "../framework/simple-cli.js";

export function sessionOption(help = "Session name") {
  return SimpleCLI.option(z.string().optional(), { help });
}

export function pageOption(help = "Target a specific page id") {
  return SimpleCLI.option(z.string().optional(), { help });
}

export function integerOption(help?: string) {
  return SimpleCLI.option(z.coerce.number().int().optional(), { help });
}

export type SessionContext = {
  session: string;
  logger: LoggerApi;
};

export type SessionStateContext = SessionContext & {
  sessionState: SessionState;
};

export function withRequiredSession(): SimpleCLIMiddleware<
  { session?: string },
  {},
  SessionStateContext
> {
  return async ({ input, ctx }) => {
    if (!input.session) {
      throw new Error("Missing required option --session.");
    }
    validateSessionName(input.session);
    const logger = createLoggerForSession(input.session);
    return {
      ...ctx,
      session: input.session,
      logger,
      sessionState: readSessionStateOrThrow(input.session),
    };
  };
}

export function withAutoSession(): SimpleCLIMiddleware<
  { session?: string },
  {},
  SessionContext
> {
  return async ({ input, ctx }) => {
    const session = input.session ?? generateSessionName();
    if (input.session) {
      validateSessionName(input.session);
    }
    const logger = createLoggerForSession(session);
    return { ...ctx, session, logger };
  };
}
