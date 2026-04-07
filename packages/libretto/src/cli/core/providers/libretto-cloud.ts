import type { ProviderApi } from "./types.js";

export function createLibrettoCloudProvider(): ProviderApi {
  const apiKey = process.env.LIBRETTO_API_KEY;
  if (!apiKey)
    throw new Error(
      "LIBRETTO_API_KEY is required for the Libretto Cloud provider.",
    );
  const apiUrl = process.env.LIBRETTO_API_URL;
  if (!apiUrl)
    throw new Error(
      "LIBRETTO_API_URL is required for the Libretto Cloud provider.",
    );
  const endpoint = apiUrl.replace(/\/$/, "");

  return {
    async createSession() {
      const timeoutSeconds = Number(
        process.env.LIBRETTO_TIMEOUT_SECONDS ?? 7200,
      );
      const resp = await fetch(`${endpoint}/v1/sessions/create`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ timeout_seconds: timeoutSeconds }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Libretto Cloud API error (${resp.status}): ${body}`,
        );
      }
      const json = (await resp.json()) as {
        session_id: string;
        cdp_url: string;
      };
      return {
        sessionId: json.session_id,
        cdpEndpoint: json.cdp_url,
      };
    },
    async closeSession(sessionId) {
      const resp = await fetch(`${endpoint}/v1/sessions/close`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Libretto Cloud API error closing session ${sessionId} (${resp.status}): ${body}`,
        );
      }
    },
  };
}
