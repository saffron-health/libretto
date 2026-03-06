import yargs, { type Argv, type ArgumentsCamelCase } from "yargs";
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
  generateSessionName,
  logFileForSession,
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

const SESSION_REQUIRED_COMMANDS = new Set([
  "run",
  "session-mode",
  "save",
  "exec",
  "snapshot",
  "network",
  "actions",
  "close",
]);

function initializeLogger(rawArgs: string[], session: string): void {
  const logFilePath = logFileForSession(session);

  setLogFile(logFilePath);
  getLog().info("cli-start", {
    args: rawArgs,
    cwd: process.cwd(),
    session,
  });
}

function invalidSessionValueMessage(): string {
  return "Usage: libretto-cli <command> [--session <name>]\nMissing or invalid --session value.";
}

function getCommand(argv: ArgumentsCamelCase): string | null {
  const commandValue = argv._[0];
  return typeof commandValue === "string" ? commandValue : null;
}

function getCommandArgs(argv: ArgumentsCamelCase): string[] {
  return argv._.filter((item): item is string => typeof item === "string");
}

function getRawSession(argv: ArgumentsCamelCase): unknown {
  return (argv as { session?: unknown }).session;
}

function autoCreateSessionForOpen(argv: ArgumentsCamelCase): void {
  const command = getCommand(argv);
  const rawSession = getRawSession(argv);
  if (command === "open" && rawSession === undefined) {
    (argv as { session?: string }).session = generateSessionName();
  }
}

function assertSession(argv: ArgumentsCamelCase): string | undefined {
  const command = getCommand(argv);
  const rawSession = getRawSession(argv);

  if (rawSession !== undefined) {
    if (typeof rawSession !== "string") {
      return invalidSessionValueMessage();
    }
    if (!rawSession || rawSession.startsWith("--")) {
      return invalidSessionValueMessage();
    }
    if (CLI_COMMANDS.has(rawSession)) {
      return invalidSessionValueMessage();
    }
    try {
      validateSessionName(rawSession);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  if (!command || command === "help") {
    return undefined;
  }

  if (SESSION_REQUIRED_COMMANDS.has(command) && rawSession === undefined) {
    return `Missing --session for "${command}". Start with 'libretto-cli open <url>' and use the returned session id.`;
  }

  return undefined;
}

function createParser(
  rawArgs: string[],
  onArgvResolved: (argv: ArgumentsCamelCase) => void,
): Argv {
  let parser: Argv = (yargs(rawArgs) as Argv)
    .scriptName("libretto-cli")
    .parserConfiguration({ "populate--": true })
    .strictCommands()
    .demandCommand(1)
    .option("session", {
      type: "string",
      describe: "Use a named session",
      global: true,
    })
    .requiresArg("session")
    .middleware((argv) => {
      autoCreateSessionForOpen(argv);
    }, true)
    .check((argv) => {
      const error = assertSession(argv);
      if (error) return error;
      return true;
    })
    .middleware((argv) => onArgvResolved(argv))
    .exitProcess(false)
    .showHelpOnFail(true)
    .version(false);

  parser = registerBrowserCommands(parser);
  parser = registerExecutionCommands(parser);
  parser = registerLogCommands(parser);
  parser = registerAICommands(parser);
  parser = registerSnapshotCommands(parser);

  return parser;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  ensureLibrettoSetup();
  let loggerInitialized = false;

  try {
    const parser = createParser(rawArgs, (argv) => {
      if (loggerInitialized) {
        return;
      }
      const command = getCommand(argv);
      const session = getRawSession(argv);
      if (!command || command === "help" || typeof session !== "string") {
        return;
      }
      initializeLogger(rawArgs, session);
      const logger = getLog();
      logger.info("cli-command", {
        command,
        args: getCommandArgs(argv),
      });
      loggerInitialized = true;
    });

    if (rawArgs.length === 0) {
      parser.showHelp();
      await flushLog();
      process.exit(0);
    }

    await parser.parseAsync();

    await flushLog();
    process.exit(0);
  } catch (err) {
    if (loggerInitialized) {
      getLog().error("cli-error", { error: err, args: rawArgs });
    }
    await flushLog();
    if (!(err instanceof Error && err.name === "YError")) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
    }
    process.exit(1);
  }
}
