import { resolveAiSetupStatus } from "./core/ai-model.js";
import { ensureLibrettoSetup } from "./core/context.js";
import { createCLIApp } from "./router.js";
import { warnIfInstalledSkillOutOfDate } from "./core/skill-version.js";
import { loadEnv } from "../shared/env/load-env.js";

function renderUsage(app: ReturnType<typeof createCLIApp>): string {
  return `${app.renderHelp()}

Options:
  --session <name>        Use a named session (auto-generated for open/run if omitted)

Docs (agent-friendly): https://libretto.sh/docs
`;
}

function printSetupAudit(): void {
  warnIfInstalledSkillOutOfDate();

  const status = resolveAiSetupStatus();
  switch (status.kind) {
    case "ready":
      console.log(`✓ Snapshot model: ${status.model}`);
      break;
    case "configured-missing-credentials":
      console.log(
        `✗ ${status.provider} configured (model: ${status.model}), but credentials are missing. Run \`npx libretto setup\` to repair.`,
      );
      break;
    case "invalid-config":
      console.log(
        `✗ AI config is invalid. Run \`npx libretto setup\` to reconfigure.`,
      );
      break;
    case "unconfigured":
      console.log(
        `✗ No AI model configured. Run \`npx libretto setup\` or \`npx libretto ai configure\` to set up.`,
      );
      break;
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
  loadEnv();
  ensureLibrettoSetup();
  const app = createCLIApp();

  try {
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
      console.error(`${message}\n`);
      console.log(renderUsage(app));
    } else {
      console.error(message);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}
