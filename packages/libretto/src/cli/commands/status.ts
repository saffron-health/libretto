import { LIBRETTO_CONFIG_PATH } from "../core/context.js";
import { type AiSetupStatus, resolveAiSetupStatus } from "../core/ai-model.js";
import { listRunningSessions, type SessionState } from "../core/session.js";
import { SimpleCLI } from "../framework/simple-cli.js";

// ── AI status printing ──────────────────────────────────────────────────────

function printAiStatus(status: AiSetupStatus): void {
  console.log("AI configuration:");

  switch (status.kind) {
    case "ready":
      console.log(`  ✓ Model: ${status.model}`);
      if (status.source === "config") {
        console.log(`  Config: ${LIBRETTO_CONFIG_PATH}`);
      } else {
        console.log(`  Source: ${status.source}`);
      }
      console.log(
        "  To change: npx libretto ai configure openai | anthropic | gemini | vertex",
      );
      break;

    case "configured-missing-credentials":
      console.log(
        `  ✗ ${status.provider} is configured (model: ${status.model}), but credentials are missing.`,
      );
      console.log("  Run `npx libretto setup` to repair.");
      break;

    case "invalid-config":
      console.log("  ✗ Config is invalid:");
      for (const line of status.message.split("\n")) {
        console.log(`    ${line}`);
      }
      console.log("  Run `npx libretto setup` to reconfigure.");
      break;

    case "unconfigured":
      console.log("  ✗ No AI model configured.");
      console.log(
        "  Run `npx libretto setup` or `npx libretto ai configure` to set up.",
      );
      break;
  }
}

// ── Session status printing ─────────────────────────────────────────────────

function printOpenSessions(sessions: SessionState[]): void {
  console.log("\nOpen sessions:");

  if (sessions.length === 0) {
    console.log("  No open sessions.");
    return;
  }

  for (const session of sessions) {
    const statusLabel = session.status ? ` [${session.status}]` : "";
    const endpoint = session.provider
      ? `${session.provider.name} (${session.cdpEndpoint})`
      : `http://127.0.0.1:${session.port}`;
    console.log(`  ${session.session}${statusLabel} — ${endpoint}`);
  }
}

// ── Command ─────────────────────────────────────────────────────────────────

export const statusCommand = SimpleCLI.command({
  description: "Show workspace status: AI configuration and open sessions",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    const aiStatus = resolveAiSetupStatus();
    printAiStatus(aiStatus);

    const sessions = listRunningSessions();
    printOpenSessions(sessions);
  });
