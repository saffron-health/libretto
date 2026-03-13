import { z } from "zod";
import { SESSION_DEFAULT, validateSessionName } from "../core/session.js";
import { SimpleCLI } from "../framework/simple-cli.js";

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
