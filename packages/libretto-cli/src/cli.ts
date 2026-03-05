import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { registerBrowserCommands } from "./commands/browser";
import { registerExecutionCommands } from "./commands/execution";
import { registerLogCommands } from "./commands/logs";
import { registerSnapshotCommands } from "./commands/snapshot";
import { flushLog, getLog, setLogFile, STATE_DIR } from "./core/context";
import {
  getStateFilePath,
  logFileForRun,
  SESSION_DEFAULT,
  validateSessionName,
  type SessionState,
} from "./core/session";

const CLI_COMMANDS = new Set([
  "open",
  "run",
  "save",
  "exec",
  "snapshot",
  "network",
  "actions",
  "close",
  "--help",
  "-h",
  "help",
]);

function printUsage(): void {
  console.log(`Usage: libretto-cli <command> [--session <name>]

Commands:
  open <url> [--headless] Launch browser and open URL (headed by default)
                          Automatically loads saved profile if available
  run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--headed|--headless] [--debug <true|false>]  Run an exported async integration function from a file
  save <url|domain>       Save current browser session (cookies, localStorage, etc.)
  exec <code> [--visualize]  Execute Playwright typescript code (--visualize enables ghost cursor + highlight)
  snapshot [--objective <text> --context <text>]  Capture PNG + HTML; analyze when both flags are provided
  snapshot configure <codex|opencode|claude|gemini> [-- <command prefix...>]  Configure snapshot analyzer
  network [--last N] [--filter regex] [--method M] [--clear]  View captured network requests
  actions [--last N] [--filter regex] [--action TYPE] [--source SOURCE] [--clear]  View captured actions
  close                   Close the browser

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
  libretto-cli snapshot configure codex
  libretto-cli snapshot configure opencode
  libretto-cli snapshot configure claude
  libretto-cli snapshot configure gemini
  libretto-cli snapshot configure codex -- codex exec --skip-git-repo-check --sandbox read-only
  libretto-cli snapshot
  libretto-cli snapshot --objective "Find the submit button" --context "Submitting a referral form, already filled in patient details"
  libretto-cli close

  # Multiple sessions
  libretto-cli open https://site1.com --session test1
  libretto-cli open https://site2.com --session test2
  libretto-cli exec "return await page.title()" --session test1

Available in exec:
  page, context, state, browser, networkLog, actionLog

Profiles:
  Profiles are saved to .libretto-cli/profiles/<domain>.json (git-ignored)
  They persist cookies, localStorage, and session data across browser launches.

Sessions:
  Session state is stored in tmp/libretto-cli/<session>.json
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

function parseSessionForLog(rawArgs: string[]): string {
  const idx = rawArgs.indexOf("--session");
  if (idx < 0) return SESSION_DEFAULT;
  const value = rawArgs[idx + 1];
  if (!value || value.startsWith("--") || CLI_COMMANDS.has(value)) {
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
  const idx = rawArgs.indexOf("--session");
  if (idx < 0) return;
  const value = rawArgs[idx + 1];
  if (!value || value.startsWith("--") || CLI_COMMANDS.has(value)) {
    throw new Error(
      "Usage: libretto-cli <command> [--session <name>]\nMissing or invalid --session value.",
    );
  }
  validateSessionName(value);
}

function initializeLogger(rawArgs: string[]): void {
  const sessionForLog = parseSessionForLog(rawArgs);

  const runIdForLog = (() => {
    try {
      const stateFile = getStateFilePath(sessionForLog);
      if (existsSync(stateFile)) {
        const state = JSON.parse(readFileSync(stateFile, "utf-8")) as SessionState;
        if (state?.runId) return state.runId;
      }
    } catch {}
    return null;
  })();

  const logFilePath = (() => {
    if (runIdForLog) return logFileForRun(runIdForLog);
    mkdirSync(STATE_DIR, { recursive: true });
    return join(STATE_DIR, "cli.log");
  })();

  setLogFile(logFilePath);
  getLog().info("cli-start", {
    args: rawArgs,
    cwd: process.cwd(),
    session: sessionForLog,
    runId: runIdForLog,
  });
}

function createParser(): Argv {
  let parser: Argv = (yargs(hideBin(process.argv)) as Argv)
    .scriptName("libretto-cli")
    .parserConfiguration({ "populate--": true })
    .option("session", {
      type: "string",
      default: SESSION_DEFAULT,
      describe: "Use a named session",
      global: true,
    })
    .middleware((argv) => {
      validateSessionName(String(argv.session));
    })
    .exitProcess(false)
    .help(false)
    .version(false)
    .fail((msg, err) => {
      if (err) throw err;
      throw new Error(msg || "Command failed");
    });

  parser = registerBrowserCommands(parser);
  parser = registerExecutionCommands(parser);
  parser = registerLogCommands(parser);
  parser = registerSnapshotCommands(parser);
  parser = parser.command("help", "Show usage", () => {}, () => {
    printUsage();
  });

  return parser;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  initializeLogger(rawArgs);
  const log = getLog();

  try {
    validateLegacySessionArg(rawArgs);

    const args = filterSessionArgs(rawArgs);
    const command = args[0];

    log.info("cli-command", { command, args });

    if (!command || command === "--help" || command === "-h" || command === "help") {
      printUsage();
      await flushLog();
      process.exit(0);
    }

    if (!CLI_COMMANDS.has(command)) {
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      await flushLog();
      process.exit(1);
    }

    const parser = createParser();
    await parser.parseAsync();

    await flushLog();
    process.exit(0);
  } catch (err) {
    log.error("cli-error", { error: err, args: rawArgs });
    await flushLog();
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
