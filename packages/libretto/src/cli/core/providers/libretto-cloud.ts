import { HOSTED_API_URL } from "../auth-fetch.js";
import type { ProviderApi } from "./types.js";

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
      const timeoutSeconds = Number(
        process.env.LIBRETTO_TIMEOUT_SECONDS ?? 5400,
      );
      const resp = await fetch(`${endpoint}/v1/sessions/create`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          json: { timeout_seconds: timeoutSeconds },
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Libretto Cloud API error (${resp.status}): ${body}`);
      }
      const { json } = (await resp.json()) as {
        json: {
          session_id: string;
          cdp_url: string;
          live_view_url: string | null;
          recording_url: string | null;
        };
      };
      return {
        sessionId: json.session_id,
        cdpEndpoint: json.cdp_url,
        liveViewUrl: json.live_view_url ?? undefined,
      };
    },
    async closeSession(sessionId) {
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
      return { replayUrl: json.replay_url ?? undefined };
    },
  };
}
