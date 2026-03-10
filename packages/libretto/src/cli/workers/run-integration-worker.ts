import { writeFile } from "node:fs/promises";
import { ZodError } from "zod";
import {
  RunIntegrationWorkerRequestSchema,
  type RunIntegrationWorkerMessage,
  type RunIntegrationWorkerRequest,
} from "./run-integration-worker-protocol.js";
import { runIntegrationFromFileInWorker } from "./run-integration-runtime.js";
import {
  ensureLibrettoSetup,
  withSessionLogger,
} from "../core/context.js";
import { getPauseSignalPaths } from "../core/pause-signals.js";

function sendMessage(message: RunIntegrationWorkerMessage): void {
  if (typeof process.send !== "function" || !process.connected) return;
  try {
    process.send(message);
  } catch {
    // Parent may have disconnected after initial run returns on pause.
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

  try {
    return RunIntegrationWorkerRequestSchema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Worker payload is invalid: ${details}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  let request: RunIntegrationWorkerRequest | null = null;
  let exitCode = 0;
  try {
    request = parseWorkerRequest(process.argv);
    const workerRequest = request;
    ensureLibrettoSetup();
    let outcomeStatus: "completed" | "failed-held" = "completed";
    await withSessionLogger(workerRequest.session, async (logger) => {
      const outcome = await runIntegrationFromFileInWorker(
        workerRequest,
        logger,
        async (details) => {
          sendMessage({ type: "paused", details });
        },
      );
      outcomeStatus = outcome.status;
    });
    if (outcomeStatus === "completed") {
      sendMessage({ type: "completed" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request) {
      const { failedSignalPath } = getPauseSignalPaths(request.session);
      await writeFile(
        failedSignalPath,
        JSON.stringify(
          {
            failedAt: new Date().toISOString(),
            message,
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    sendMessage({ type: "failed", message });
    exitCode = 1;
  }
  process.exit(exitCode);
}

void main();
