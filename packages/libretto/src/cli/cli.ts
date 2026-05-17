import { ensureLibrettoSetup } from "./core/context.js";
import { createCLIApp } from "./router.js";
import {
  readCurrentCliVersion,
  warnIfInstalledSkillOutOfDate,
} from "./core/skill-version.js";
import { loadEnv } from "../shared/env/load-env.js";

function renderUsage(app: ReturnType<typeof createCLIApp>): string {
  return [
    app.renderHelp(),
    "",
    "Options:",
    "  --session <name>  Required for session-scoped commands",
    "  -h, --help",
    "  -v, --version",
  ].join("\n");
}

function renderVersion(): string {
  return readCurrentCliVersion();
}

function printSetupAudit(): void {
  warnIfInstalledSkillOutOfDate();
}

function isPackageManagerExec(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.npm_command === "exec";
}

function warnIfPackageManagerExec(): void {
  if (!isPackageManagerExec()) return;

  console.error(
    [
      "Warning: running Libretto through a package manager is deprecated and will be removed in a future release.",
      "Install the native command instead:",
      "  curl -fsSL https://libretto.sh/install.sh | bash",
    ].join("\n"),
  );
}

function isRootHelpRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length === 0) return true;
  if (rawArgs[0] === "--help" || rawArgs[0] === "-h") return true;
  return rawArgs[0] === "help" && rawArgs.length === 1;
}

function isVersionRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length !== 1) return false;
  return rawArgs[0] === "--version" || rawArgs[0] === "-v";
}

function hasRootHelp(
  message: string,
  app: ReturnType<typeof createCLIApp>,
): boolean {
  return message.endsWith(app.renderHelp());
}

function hasScopedHelp(message: string): boolean {
  return message.includes("\nUsage: ");
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let exitCode = 0;
  loadEnv();
  warnIfPackageManagerExec();
  ensureLibrettoSetup();
  const app = createCLIApp();

  try {
    if (isVersionRequest(rawArgs)) {
      console.log(renderVersion());
      return;
    }

    if (isRootHelpRequest(rawArgs)) {
      console.log(renderUsage(app));
      printSetupAudit();
      return;
    }

    const result = await app.run(rawArgs);
    if (typeof result === "string") {
      console.log(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Unknown command: ")) {
      if (hasRootHelp(message, app)) {
        const summary = message.split("\n", 1)[0] ?? message;
        console.error(`${summary}\n`);
        console.log(renderUsage(app));
      } else if (hasScopedHelp(message)) {
        console.error(message);
      } else {
        console.error(`${message}\n`);
        console.log(renderUsage(app));
      }
    } else {
      console.error(message);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}
