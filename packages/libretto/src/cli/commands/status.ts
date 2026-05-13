import { listRunningSessions, type SessionState } from "../core/session.js";
import { SimpleCLI } from "affordance";

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
  description: "Show workspace status and open sessions",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    const sessions = listRunningSessions();
    printOpenSessions(sessions);
  });
