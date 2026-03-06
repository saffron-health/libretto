import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { registerAICommands } from "./commands/ai";
import { registerBrowserCommands } from "./commands/browser";
import { registerExecutionCommands } from "./commands/execution";
import { registerLogCommands } from "./commands/logs";
import { registerSnapshotCommands } from "./commands/snapshot";
import {
  ensureLibrettoSetup,
  flushLog,
  getLog,
  setLogFile,
} from "./core/context";
import {
  logFileForSession,
  SESSION_DEFAULT,
  validateSessionName,
} from "./core/session";

const CLI_COMMANDS = new Set([
  "open",
  "run",
  "session-mode",
  "ai",
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
  run <integrationFile> <integrationExport> [--params <json> | --params-file <path>] [--headed|--headless] [--debug <true|false>]  Run an exported Libretto workflow from a file (blocked until interactive)
  session-mode <read-only|interactive> Set session execution mode
  ai configure [preset] [-- <command prefix...>]  Configure AI runtime for analysis commands
  save <url|domain>       Save current browser session (cookies, localStorage, etc.)
  exec <code> [--visualize]  Execute Playwright typescript code (--visualize enables ghost cursor + highlight; blocked until interactive)
  snapshot [--objective <text> --context <text>]  Capture PNG + HTML; analyze when both flags are provided
  network [--last N] [--filter regex] [--method M] [--clear]  View captured network requests
  actions [--last N] [--filter regex] [--action TYPE] [--source SOURCE] [--clear]  View captured actions
  close                   Close the browser

Options:
  --session <name>        Use a named session (default: "default")
                          Built-in sessions: default, dev-server, browser-agent

Examples:
  libretto-cli open https://linkedin.com
  # default sessions are read-only; enable actions only after explicit human approval
  libretto-cli session-mode interactive --session default

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
  libretto-cli close

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
  const logFilePath = logFileForSession(sessionForLog);

  setLogFile(logFilePath);
  getLog().info("cli-start", {
    args: rawArgs,
    cwd: process.cwd(),
    session: sessionForLog,
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
  parser = registerAICommands(parser);
  parser = registerSnapshotCommands(parser);
  parser = parser.command("help", "Show usage", () => {}, () => {
    printUsage();
  });

  return parser;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  ensureLibrettoSetup();
  initializeLogger(rawArgs);
  const log = getLog();

  try {
    validateLegacySessionArg(rawArgs);

    const args = filterSessionArgs(rawArgs);
    const command = args[0];

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
    log.info("cli-command", { command, args });
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
