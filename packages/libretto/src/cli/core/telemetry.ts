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
  installId?: string;
  enabled?: boolean;
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
  return (
    process.env.LIBRETTO_TELEMETRY_DISABLED === "1" ||
    process.env.DO_NOT_TRACK === "1" ||
    process.env.CI === "1"
  );
}

async function readTelemetryState(): Promise<StoredTelemetryState | null> {
  try {
    const raw = await fs.readFile(telemetryPath(), "utf8");
    return JSON.parse(raw) as Partial<StoredTelemetryState>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function readOrCreateInstallId(): Promise<string | null> {
  const state = await readTelemetryState();
  if (state?.enabled === false) return null;

  if (typeof state?.installId === "string" && state.installId.length > 0) {
    return state.installId;
  }

  const installId = randomUUID();
  writeTelemetryNotice();
  await writeTelemetryState({ installId, enabled: true });
  return installId;
}

function writeTelemetryNotice(): void {
  if (!process.stderr.isTTY) return;
  process.stderr.write(
    [
      "Libretto collects anonymous CLI telemetry: install id, timestamp, command event, and error status only.",
      "Set LIBRETTO_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1 to disable it, or set enabled:false in ~/.libretto/telemetry.json.",
    ].join(" ") + "\n",
  );
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
  const installId = await readOrCreateInstallId();
  if (!installId) return;

  await sendWithTimeout({
    installId,
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
