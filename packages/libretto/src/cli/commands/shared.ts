import { z } from "zod";
import type { LoggerApi } from "../../shared/logger/index.js";
import type { Experiments } from "../core/experiments.js";
import { resolveExperiments } from "../core/experiments.js";
import { createLoggerForSession } from "../core/context.js";
import {
  generateSessionName,
  readSessionStateOrThrow,
  type SessionState,
  validateSessionName,
} from "../core/session.js";
import { resolveApiUrl } from "../core/auth-fetch.js";
import {
  SimpleCLI,
  type SimpleCLIContext,
  type SimpleCLIMiddleware,
} from "affordance";

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

export type ExperimentsContext = {
  experiments: Experiments;
};

export type CloudApiKeyContext = {
  apiUrl: string;
  credential: { source: "env-api-key"; apiKey: string };
};

export function withExperiments<
  TContext extends SimpleCLIContext,
>(): SimpleCLIMiddleware<unknown, TContext, TContext & ExperimentsContext> {
  return async ({ ctx }) => ({
    ...ctx,
    experiments: resolveExperiments(),
  });
}

export function withCloudApiKey<
  TContext extends SimpleCLIContext,
>(
  action: string,
  formatMissingMessage?: () => string | Promise<string>,
): SimpleCLIMiddleware<unknown, TContext, TContext & CloudApiKeyContext> {
  return async ({ ctx }) => {
    const apiKey = process.env.LIBRETTO_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        formatMissingMessage
          ? await formatMissingMessage()
          : `LIBRETTO_API_KEY is required to ${action}. Issue one with \`libretto cloud auth api-key issue --label <label>\`.`,
      );
    }
    return {
      ...ctx,
      apiUrl: resolveApiUrl(null),
      credential: { source: "env-api-key", apiKey },
    };
  };
}

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
