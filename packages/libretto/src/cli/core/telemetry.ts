import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SimpleCLICommandMeta, SimpleCLIMiddleware } from "affordance";
import { resolveHostedApiUrl } from "./auth-fetch.js";

const TELEMETRY_FILE_NAME = "telemetry.json";
const TELEMETRY_ENDPOINT_PATH = "/v1/telemetry/recordCliEvent";
const TELEMETRY_TIMEOUT_MS = 250;

type StoredTelemetryState = {
  installId: string;
};

type CliTelemetryPayload = {
  installId: string;
  timestamp: string;
  event: string;
  error: boolean;
};

function telemetryDir(): string {
  return join(homedir(), ".libretto");
}

function telemetryPath(): string {
  return join(telemetryDir(), TELEMETRY_FILE_NAME);
}

function isTelemetryDisabled(): boolean {
  return process.env.LIBRETTO_TELEMETRY_DISABLED === "1";
}

async function readOrCreateInstallId(): Promise<string> {
  try {
    const raw = await fs.readFile(telemetryPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredTelemetryState>;
    if (typeof parsed.installId === "string" && parsed.installId.length > 0) {
      return parsed.installId;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const installId = randomUUID();
  await writeTelemetryState({ installId });
  return installId;
}

async function writeTelemetryState(state: StoredTelemetryState): Promise<void> {
  await fs.mkdir(telemetryDir(), { recursive: true, mode: 0o700 });
  const target = telemetryPath();
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
}

async function recordCliTelemetryEvent(
  command: SimpleCLICommandMeta,
  error: boolean,
): Promise<void> {
  if (isTelemetryDisabled()) return;

  await sendWithTimeout({
    installId: await readOrCreateInstallId(),
    timestamp: new Date().toISOString(),
    event: `libretto ${command.path.join(" ")}`,
    error,
  });
}

async function sendWithTimeout(payload: CliTelemetryPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
  try {
    await fetch(`${resolveHostedApiUrl()}${TELEMETRY_ENDPOINT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: payload }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const telemetryMiddleware: SimpleCLIMiddleware<
  unknown,
  {},
  {}
> = async ({ command, next }) => {
  try {
    const result = await next();
    await recordCliTelemetryEvent(command, false).catch(() => {});
    return result;
  } catch (error) {
    await recordCliTelemetryEvent(command, true).catch(() => {});
    throw error;
  }
};
