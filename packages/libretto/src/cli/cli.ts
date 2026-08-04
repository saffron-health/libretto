import { ensureLibrettoSetup } from "./core/context.js";
import { createCLIApp } from "./router.js";
import {
  readCurrentCliVersion,
  warnIfLibrettoVersionsDiffer,
} from "./core/skill-version.js";
import { loadEnv } from "../shared/env/load-env.js";
import { formatErrorWithCauses } from "./core/workflow-runner/workflow-error.js";

function renderVersion(): string {
  return readCurrentCliVersion();
}

function printSetupAudit(): void {
  warnIfLibrettoVersionsDiffer();
}

function isRootHelpRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length === 0) return true;
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

function formatCliError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  // Workflow run failures already embed the actionable stack (+ cause) in message.
  if (
    err.message.includes("\n    at ") ||
    err.message.includes("Caused by:") ||
    err.message.includes("Browser is still open.")
  ) {
    return err.message;
  }
  // Keep parser/usage errors on message so attached help text stays intact.
  if (err.cause === undefined) {
    return err.message;
  }
  return formatErrorWithCauses(err);
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let exitCode = 0;
  loadEnv();
  ensureLibrettoSetup();
  const app = createCLIApp();

  try {
    if (isVersionRequest(rawArgs)) {
      console.log(renderVersion());
      return;
    }

    if (isRootHelpRequest(rawArgs)) {
      console.log(app.renderHelp());
      printSetupAudit();
      return;
    }

    const result = await app.run(rawArgs);
    if (typeof result === "string") {
      console.log(result);
    }
  } catch (err) {
    const message = formatCliError(err);
    if (message.startsWith("Unknown command: ")) {
      if (hasRootHelp(message, app)) {
        const summary = message.split("\n", 1)[0] ?? message;
        console.error(`${summary}\n`);
        console.log(app.renderHelp());
      } else if (hasScopedHelp(message)) {
        console.error(message);
      } else {
        console.error(`${message}\n`);
        console.log(app.renderHelp());
      }
    } else {
      console.error(message);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}
