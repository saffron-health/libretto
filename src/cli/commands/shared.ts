import { z } from "zod";
import {
  SESSION_DEFAULT,
  readSessionStateOrThrow,
  type SessionState,
  validateSessionName,
} from "../core/session.js";
import {
  SimpleCLI,
  type SimpleCLIMiddleware,
} from "../framework/simple-cli.js";

export function createSessionSchema() {
  return z.string().default(SESSION_DEFAULT).superRefine((value, ctx) => {
    try {
      validateSessionName(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function sessionOption(help = "Use a named session") {
  return SimpleCLI.option(createSessionSchema(), { help });
}

export function pageOption(help = "Target a specific page id") {
  return SimpleCLI.option(z.string().optional(), { help });
}

export function integerOption(help?: string) {
  return SimpleCLI.option(z.coerce.number().int().optional(), { help });
}

export type SessionInput = {
  session: string;
};

export type SessionContext = {
  session: string;
};

export type SessionStateContext = SessionContext & {
  sessionState: SessionState;
};

export const resolveSessionMiddleware: SimpleCLIMiddleware<
  SessionInput,
  {},
  SessionContext
> = async ({ input, ctx }) => {
  return {
    ...ctx,
    session: input.session,
  };
};

export const loadSessionStateMiddleware: SimpleCLIMiddleware<
  SessionInput,
  SessionContext,
  SessionStateContext
> = async ({ ctx }) => {
  return {
    ...ctx,
    sessionState: readSessionStateOrThrow(ctx.session),
  };
};
