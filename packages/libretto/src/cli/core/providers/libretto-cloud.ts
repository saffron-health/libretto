import { HOSTED_API_URL } from "../auth-fetch.js";
import type { ProviderApi } from "./types.js";

type CloudSessionResponse = {
  session_id: string;
  status: string;
  cdp_url: string | null;
  live_view_url: string | null;
  recording_url: string | null;
};

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS = 7_200;
const QUEUE_WAIT_TIMEOUT_MS = 10 * 60_000;

export function createLibrettoCloudProvider(): ProviderApi {
  const apiKey = process.env.LIBRETTO_API_KEY;
  if (!apiKey)
    throw new Error(
      "LIBRETTO_API_KEY is required for the Libretto Cloud provider.",
    );
  const endpoint = HOSTED_API_URL;

  // The Libretto Cloud API is an oRPC RPCHandler, not plain REST, so inputs
  // must be wrapped as { json: ... } and outputs arrive the same way.
  return {
    async createSession() {
      const browserSessionTimeoutSeconds = readPositiveNumberEnv(
        "LIBRETTO_TIMEOUT_SECONDS",
        DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS,
      );
      const resp = await fetch(`${endpoint}/v1/sessions/create`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          json: { timeout_seconds: browserSessionTimeoutSeconds },
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Libretto Cloud API error (${resp.status}): ${body}`);
      }
      const { json } = (await resp.json()) as { json: CloudSessionResponse };
      const startupCleanup = createStartupSessionCleanup(
        endpoint,
        apiKey,
        json.session_id,
      );
      let readySession: CloudSessionResponse & { cdp_url: string };
      try {
        readySession = await waitForCloudSessionReady({
          endpoint,
          apiKey,
          session: json,
          timeoutMs: QUEUE_WAIT_TIMEOUT_MS,
          isCancelled: startupCleanup.isCancelled,
        });
      } catch (error) {
        if (startupCleanup.isCancelled()) {
          await startupCleanup.waitForClose();
        } else {
          await closeCloudSession(endpoint, apiKey, json.session_id).catch(
            () => {},
          );
        }
        throw error;
      } finally {
        startupCleanup.dispose();
      }
      return {
        sessionId: readySession.session_id,
        cdpEndpoint: readySession.cdp_url,
        liveViewUrl: readySession.live_view_url ?? undefined,
      };
    },
    async closeSession(sessionId) {
      const json = await closeCloudSession(endpoint, apiKey, sessionId);
      return { replayUrl: json.replay_url ?? undefined };
    },
  };
}

async function waitForCloudSessionReady(args: {
  endpoint: string;
  apiKey: string;
  session: CloudSessionResponse;
  timeoutMs: number;
  isCancelled?: () => boolean;
}): Promise<CloudSessionResponse & { cdp_url: string }> {
  let session = args.session;
  if (args.isCancelled?.()) {
    throw new Error(
      `Libretto Cloud session ${session.session_id} was cancelled before browser capacity was available.`,
    );
  }
  if (session.cdp_url) {
    return { ...session, cdp_url: session.cdp_url };
  }

  sendStartupStatus(
    `Libretto Cloud browser session queued (session: ${session.session_id}). Waiting for browser capacity...`,
  );

  const pollIntervalMs = readPositiveNumberEnv(
    "LIBRETTO_CLOUD_SESSION_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + args.timeoutMs;

  while (Date.now() < deadline) {
    if (args.isCancelled?.()) {
      throw new Error(
        `Libretto Cloud session ${session.session_id} was cancelled before browser capacity was available.`,
      );
    }
    await sleep(pollIntervalMs);
    if (args.isCancelled?.()) {
      throw new Error(
        `Libretto Cloud session ${session.session_id} was cancelled before browser capacity was available.`,
      );
    }
    session = await getCloudSession(
      args.endpoint,
      args.apiKey,
      session.session_id,
    );
    if (session.cdp_url) {
      sendStartupStatus(
        `Libretto Cloud browser capacity available (session: ${session.session_id}). Connecting...`,
      );
      return { ...session, cdp_url: session.cdp_url };
    }
    if (!["queued", "starting"].includes(session.status)) {
      throw new Error(
        `Libretto Cloud session ${session.session_id} entered status "${session.status}" before a CDP URL was available.`,
      );
    }
  }

  throw new Error(
    `Timed out waiting for Libretto Cloud browser capacity after ${Math.ceil(args.timeoutMs / 1_000)}s (session: ${session.session_id}).`,
  );
}

async function getCloudSession(
  endpoint: string,
  apiKey: string,
  sessionId: string,
): Promise<CloudSessionResponse> {
  const resp = await fetch(`${endpoint}/v1/sessions/get`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ json: { session_id: sessionId } }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Libretto Cloud API error reading session ${sessionId} (${resp.status}): ${body}`,
    );
  }
  const { json } = (await resp.json()) as { json: CloudSessionResponse };
  return json;
}

async function closeCloudSession(
  endpoint: string,
  apiKey: string,
  sessionId: string,
): Promise<{ replay_url: string | null }> {
  const resp = await fetch(`${endpoint}/v1/sessions/close`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ json: { session_id: sessionId } }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Libretto Cloud API error closing session ${sessionId} (${resp.status}): ${body}`,
    );
  }
  const { json } = (await resp.json()) as {
    json: { replay_url: string | null };
  };
  return json;
}

function createStartupSessionCleanup(
  endpoint: string,
  apiKey: string,
  sessionId: string,
): {
  isCancelled: () => boolean;
  waitForClose: () => Promise<void>;
  dispose: () => void;
} {
  let cancelled = false;
  let closePromise: Promise<void> | null = null;

  const requestClose = (reason: string): void => {
    if (cancelled) return;
    cancelled = true;
    sendStartupStatus(
      `Libretto Cloud browser session cancelled (${reason}). Cleaning up queued session...`,
    );
    closePromise = closeCloudSession(endpoint, apiKey, sessionId).then(
      () => {},
      () => {},
    );
  };

  const onDisconnect = (): void => requestClose("parent command disconnected");
  const onSigint = (): void => requestClose("received SIGINT");
  const onSigterm = (): void => requestClose("received SIGTERM");

  if (typeof process.send === "function") {
    process.once("disconnect", onDisconnect);
  }
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return {
    isCancelled: () => cancelled,
    waitForClose: async () => {
      await closePromise;
    },
    dispose: () => {
      process.off("disconnect", onDisconnect);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sendStartupStatus(message: string): void {
  if (typeof process.send === "function") {
    process.send({ type: "startup-status", message });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
