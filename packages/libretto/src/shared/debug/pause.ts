import { listRunningSessions } from "../../cli/core/session.js";
import { librettoCommand } from "../../cli/core/package-manager.js";
import { getActivePauseHandler } from "./pause-handler.js";

function throwMissingSessionError(): never {
  const runningSessions = listRunningSessions();
  const lines = ["pause(session) requires a non-empty session ID."];

  if (runningSessions.length > 0) {
    lines.push("", "Running sessions:");
    for (const s of runningSessions) {
      lines.push(`  ${s.session}`);
    }
  }

  throw new Error(lines.join("\n"));
}

/**
 * Standalone pause function.
 *
 * - In production (`NODE_ENV === "production"`), returns immediately (no-op).
 * - Otherwise, delegates to the active Libretto workflow runtime pause handler.
 *
 * Import directly: `import { pause } from "libretto";`
 */
export async function pause(session: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  if (typeof session !== "string" || session.trim().length === 0) {
    throwMissingSessionError();
  }

  const handler = getActivePauseHandler();
  if (!handler) {
    throw new Error(
      `pause(session) can only suspend an active Libretto workflow. Run the workflow with ${librettoCommand("run <integrationFile>")} and call pause(ctx.session) from inside the workflow.`,
    );
  }

  await handler({
    session,
    pausedAt: new Date().toISOString(),
  });
}
