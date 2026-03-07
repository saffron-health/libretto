import type {
  RunIntegrationWorkerMessage,
  RunIntegrationWorkerRequest,
} from "./run-integration-worker-protocol.js";
import { runIntegrationFromFileInWorker } from "./run-integration-runtime.js";
import { ensureLibrettoSetup, setLogFile } from "../core/context.js";
import { logFileForSession } from "../core/session.js";

function sendMessage(message: RunIntegrationWorkerMessage): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

function parseWorkerRequest(argv: string[]): RunIntegrationWorkerRequest {
  const rawPayload = argv[2];
  if (!rawPayload) {
    throw new Error("Missing worker payload argument.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (error) {
    throw new Error(
      `Invalid worker payload JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Worker payload must be an object.");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.integrationPath !== "string" ||
    typeof candidate.exportName !== "string" ||
    typeof candidate.session !== "string" ||
    typeof candidate.headless !== "boolean" ||
    typeof candidate.debug !== "boolean" ||
    !("params" in candidate)
  ) {
    throw new Error("Worker payload is missing required fields.");
  }

  return {
    integrationPath: candidate.integrationPath,
    exportName: candidate.exportName,
    session: candidate.session,
    headless: candidate.headless,
    debug: candidate.debug,
    params: candidate.params,
  };
}

async function main(): Promise<void> {
  try {
    const request = parseWorkerRequest(process.argv);
    ensureLibrettoSetup();
    setLogFile(logFileForSession(request.session));
    const outcome = await runIntegrationFromFileInWorker(
      request,
      async (details) => {
        sendMessage({ type: "paused", details });
      },
    );
    if (outcome.status !== "completed") {
      throw new Error(
        "Invariant violation: worker returned paused outcome instead of hanging.",
      );
    }
    sendMessage({ type: "completed" });
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendMessage({ type: "failed", message });
    process.exit(1);
  }
}

void main();
