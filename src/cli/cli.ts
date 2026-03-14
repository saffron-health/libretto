import type { Logger } from "../shared/logger/index.js";
import {
  closeLogger,
  createLoggerForSession,
  ensureLibrettoSetup,
} from "./core/context.js";
import {
  SESSION_DEFAULT,
  validateSessionName,
} from "./core/session.js";
import { createCLIApp } from "./router.js";

function renderUsage(app: ReturnType<typeof createCLIApp>): string {
  return `${app.renderHelp()}

Options:
  --session <name>        Use a named session (default: "default")
                          Built-in sessions: default, dev-server, browser-agent

Examples:
  libretto-cli open https://linkedin.com

  # ... manually log in ...
  libretto-cli save linkedin.com
  # Next time you open linkedin.com, you'll be logged in automatically

  libretto-cli exec "await page.locator('button:has-text(\\"Sign in\\")').click()"
  libretto-cli exec "await page.fill('input[name=\\"email\\"]', 'test@example.com')"
  libretto-cli ai configure codex
  libretto-cli ai configure claude
  libretto-cli ai configure gemini
  libretto-cli ai configure <codex|claude|gemini> -- <command prefix...>
  libretto-cli snapshot
  libretto-cli snapshot --objective "Find the submit button" --context "Submitting a referral form, already filled in patient details"
  libretto-cli resume --session default
  libretto-cli close
  libretto-cli close --all
  libretto-cli close --all --force

  # Multiple sessions
  libretto-cli open https://site1.com --session test1
  libretto-cli open https://site2.com --session test2
  libretto-cli exec "return await page.title()" --session test1

Available in exec:
  page, context, state, browser, networkLog, actionLog

Profiles:
  Profiles are saved to .libretto/profiles/<domain>.json (git-ignored)
  They persist cookies, localStorage, and session data across browser launches.
  Local profiles are machine-local and are not shared with other users/environments.
  Sessions can expire; if run fails auth, log in again and re-save the profile.

Sessions:
  Session state is stored in .libretto/sessions/<session>/state.json
  CLI logs are stored in .libretto/sessions/<session>/logs.jsonl
  Each session runs an isolated browser instance on a dynamic port.
`;
}

function readSessionArgBeforePassthrough(
  rawArgs: readonly string[],
): string | null | undefined {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === "--") return undefined;
    if (token === "--session") {
      const value = rawArgs[index + 1];
      if (!value || value === "--" || value.startsWith("--")) {
        return null;
      }
      return value;
    }
    if (!token.startsWith("--session=")) continue;

    const value = token.slice("--session=".length);
    if (value.length === 0 || value === "--" || value.startsWith("--")) {
      return null;
    }
    return value;
  }

  return undefined;
}

function parseSessionForLog(rawArgs: string[]): string {
  const value = readSessionArgBeforePassthrough(rawArgs);
  if (value === undefined || value === null) {
    return SESSION_DEFAULT;
  }
  try {
    validateSessionName(value);
    return value;
  } catch {
    return SESSION_DEFAULT;
  }
}

function validateLegacySessionArg(rawArgs: string[]): void {
  const value = readSessionArgBeforePassthrough(rawArgs);
  if (value === undefined) return;
  if (value === null) {
    throw new Error(
      "Usage: libretto-cli <command> [--session <name>]\nMissing or invalid --session value.",
    );
  }
  validateSessionName(value);
}

function initializeLogger(rawArgs: string[]): Logger {
  const sessionForLog = parseSessionForLog(rawArgs);
  const logger = createLoggerForSession(sessionForLog);
  logger.info("cli-start", {
    args: rawArgs,
    cwd: process.cwd(),
    session: sessionForLog,
  });
  return logger;
}

async function withCliLogger<T>(
  rawArgs: string[],
  run: (logger: Logger) => Promise<T>,
): Promise<T> {
  const logger = initializeLogger(rawArgs);
  try {
    return await run(logger);
  } finally {
    await closeLogger(logger);
  }
}

function isRootHelpRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length === 0) return true;
  if (rawArgs[0] === "--help" || rawArgs[0] === "-h") return true;
  return rawArgs[0] === "help" && rawArgs.length === 1;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let exitCode = 0;
  ensureLibrettoSetup();
  await withCliLogger(rawArgs, async (logger) => {
    const app = createCLIApp(logger);

    try {
      validateLegacySessionArg(rawArgs);

      if (isRootHelpRequest(rawArgs)) {
        console.log(renderUsage(app));
        return;
      }

      logger.info("cli-command", { args: rawArgs });
      const result = await app.run(rawArgs);
      if (typeof result === "string") {
        console.log(result);
      }
    } catch (err) {
      logger.error("cli-error", { error: err, args: rawArgs });
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Unknown command: ")) {
        console.error(`${message}\n`);
        console.log(renderUsage(app));
      } else {
        console.error(message);
      }
      exitCode = 1;
    }
  });
  process.exit(exitCode);
}
