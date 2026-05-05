import { getActivePauseHandler } from "./pause-handler.js";
import { librettoCommand } from "../package-manager.js";

function throwMissingSessionError(): never {
  throw new Error(
    `pause(session) requires a non-empty session ID. Pass ctx.session from inside your workflow: await pause(ctx.session). To list running sessions, run: ${librettoCommand("status")}.`,
  );
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
