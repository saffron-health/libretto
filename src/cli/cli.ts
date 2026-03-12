import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import type { Logger } from "../shared/logger/index.js";
import { registerAICommands } from "./commands/ai.js";
import { registerBrowserCommands } from "./commands/browser.js";
import { registerExecutionCommands } from "./commands/execution.js";
import { registerLogCommands } from "./commands/logs.js";
import { registerInitCommand } from "./commands/init.js";
import { registerSnapshotCommands } from "./commands/snapshot.js";
import {
  closeLogger,
  createLoggerForSession,
  ensureLibrettoSetup,
} from "./core/context.js";
import {
  listSessionsWithStateFile,
  validateSessionName,
} from "./core/session.js";

const AUTO_SESSION_COMMANDS = new Set(["open", "run"]);
const SESSION_OPTIONAL_COMMANDS = new Set(["help", "--help", "-h", "init", "ai"]);

const CLI_COMMANDS = new Set([
  "open",
  "run",
  "ai",
  "save",
  "exec",
  "snapshot",
  "network",
  "actions",
  "pages",
  "resume",
  "close",
  "init",
  "--help",
  "-h",
  "help",
]);

function printUsage(): void {
  console.log(`Usage: libretto-cli <command> [--session <name>]

Commands:
  init [--skip-browsers] Initialize libretto (install browsers, check AI setup)
  open <url> [--headless] Launch browser and open URL (headed by default)
                          Automatically loads saved profile if available
  run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--tsconfig <path>] [--headed|--headless]  Run an exported Libretto workflow from a file
  ai configure [preset] [-- <command prefix...>]  Configure AI runtime for analysis commands
  save <url|domain>       Save current browser session (cookies, localStorage, etc.)
  exec <code> [--visualize]  Execute Playwright typescript code (--visualize enables ghost cursor + highlight)
  snapshot [--objective <text> --context <text>]  Capture PNG + HTML; analyze when objective is provided (context optional)
  network [--last N] [--filter regex] [--method M] [--clear]  View captured network requests
  actions [--last N] [--filter regex] [--action TYPE] [--source SOURCE] [--clear]  View captured actions
  pages                   List open pages in the active session
  resume                  Resume a paused workflow in the active session
  close [--all] [--force]  Close the browser for the session, or all tracked sessions with --all

Options:
  --session <name>        Use a named session
                          If omitted for open/run, a session id is auto-generated
                          All other stateful commands require --session
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
`);
}

function filterSessionArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session") {
      i++;
    } else {
      result.push(args[i]!);
    }
  }
  return result;
}

function parseSessionForLog(rawArgs: string[]): string | null {
  const idx = rawArgs.indexOf("--session");
  if (idx < 0) return null;
  const value = rawArgs[idx + 1];
  if (!value || value.startsWith("--") || CLI_COMMANDS.has(value)) {
    return null;
  }
  try {
    validateSessionName(value);
    return value;
  } catch {
    return null;
  }
}

function hasExplicitSession(rawArgs: string[]): boolean {
  return rawArgs.includes("--session");
}

function randomSessionId(): string {
  const digits = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, "0");
  return `ses-${digits}`;
}

function generateSessionId(): string {
  const activeSessions = new Set(listSessionsWithStateFile());
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const candidate = randomSessionId();
    if (!activeSessions.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Could not generate an available session id. Close an existing session and try again.",
  );
}

function hasExecCodeArg(filteredArgs: string[]): boolean {
  for (let i = 1; i < filteredArgs.length; i += 1) {
    const token = filteredArgs[i];
    if (!token) continue;
    if (token === "--") {
      return filteredArgs.length > i + 1;
    }
    if (token === "--visualize") {
      continue;
    }
    if (token === "--page") {
      const maybeValue = filteredArgs[i + 1];
      if (maybeValue && !maybeValue.startsWith("--")) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--page=")) {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    return true;
  }
  return false;
}

function commandNeedsSession(
  command: string,
  rawArgs: string[],
  filteredArgs: string[],
): boolean {
  if (AUTO_SESSION_COMMANDS.has(command)) return false;
  if (SESSION_OPTIONAL_COMMANDS.has(command)) return false;
  if (command === "close" && rawArgs.includes("--all")) return false;
  if (command === "close" && rawArgs.includes("--force")) return false;
  if (command === "exec" && !hasExecCodeArg(filteredArgs)) return false;
  if (command === "save" && filteredArgs.length <= 1) return false;
  if (!CLI_COMMANDS.has(command)) return false;
  return true;
}

function resolveSessionArgs(rawArgs: string[]): {
  args: string[];
  generatedSession: string | null;
  resolvedSession: string | null;
} {
  const filtered = filterSessionArgs(rawArgs);
  const command = filtered[0];
  const explicitSession = parseSessionForLog(rawArgs);
  if (!command) {
    return {
      args: rawArgs,
      generatedSession: null,
      resolvedSession: explicitSession,
    };
  }
  if (hasExplicitSession(rawArgs)) {
    return {
      args: rawArgs,
      generatedSession: null,
      resolvedSession: explicitSession,
    };
  }
  if (!AUTO_SESSION_COMMANDS.has(command)) {
    return {
      args: rawArgs,
      generatedSession: null,
      resolvedSession: null,
    };
  }
  const generatedSession = generateSessionId();
  return {
    args: [...rawArgs, "--session", generatedSession],
    generatedSession,
    resolvedSession: generatedSession,
  };
}

function createParser(logger: Logger): Argv {
  let parser: Argv = (yargs(hideBin(process.argv)) as Argv)
    .scriptName("libretto-cli")
    .parserConfiguration({ "populate--": true })
    .option("session", {
      type: "string",
      describe: "Use a named session",
      global: true,
      requiresArg: true,
    })
    .middleware((argv) => {
      if (argv.session !== undefined) {
        validateSessionName(String(argv.session));
      }
    })
    .exitProcess(false)
    .help(false)
    .version(false)
    .fail((msg, err) => {
      if (err) throw err;
      throw new Error(msg || "Command failed");
    });

  parser = registerBrowserCommands(parser, logger);
  parser = registerExecutionCommands(parser, logger);
  parser = registerLogCommands(parser);
  parser = registerAICommands(parser);
  parser = registerSnapshotCommands(parser, logger);
  parser = registerInitCommand(parser);
  parser = parser.command("help", "Show usage", () => {}, () => {
    printUsage();
  });

  return parser;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let exitCode = 0;
  let effectiveArgs: string[] = rawArgs;
  let generatedSession: string | null = null;
  let resolvedSession: string | null = null;

  ({
    args: effectiveArgs,
    generatedSession,
    resolvedSession,
  } = resolveSessionArgs(rawArgs));

  ensureLibrettoSetup();
  const args = filterSessionArgs(effectiveArgs);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printUsage();
    process.exit(exitCode);
    return;
  }

  if (!CLI_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
    return;
  }
  if (!hasExplicitSession(effectiveArgs) && commandNeedsSession(command, effectiveArgs, args)) {
    console.error(
      [
        `Missing required --session for "${command}".`,
        "Pass --session <name>, or use open/run without --session to auto-create one.",
      ].join("\n"),
    );
    process.exit(1);
    return;
  }

  const sessionForLogger = resolvedSession ?? "cli";
  const logger = createLoggerForSession(sessionForLogger);
  try {
    const parser = createParser(logger);
    await parser.parseAsync(effectiveArgs);
  } catch (err) {
    logger.error("cli-error", {
      error: err,
      args: rawArgs,
      effectiveArgs,
      generatedSession,
    });
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    exitCode = 1;
  } finally {
    await closeLogger(logger);
  }
  process.exit(exitCode);
}
