import type { ProviderApi } from "./types.js";

export function createBrowserbaseProvider(): ProviderApi {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey)
    throw new Error(
      "BROWSERBASE_API_KEY is required for Browserbase provider.",
    );
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!projectId)
    throw new Error(
      "BROWSERBASE_PROJECT_ID is required for Browserbase provider.",
    );
  const endpoint =
    process.env.BROWSERBASE_ENDPOINT ?? "https://api.browserbase.com";

  return {
    async createSession() {
      const resp = await fetch(`${endpoint}/v1/sessions`, {
        method: "POST",
        headers: {
          "X-BB-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Browserbase API error (${resp.status}): ${body}`);
      }
      const json = (await resp.json()) as {
        id: string;
        connectUrl: string;
      };
      return {
        sessionId: json.id,
        cdpEndpoint: json.connectUrl,
      };
    },
    async closeSession(sessionId) {
      const resp = await fetch(`${endpoint}/v1/sessions/${sessionId}`, {
        method: "POST",
        headers: {
          "X-BB-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "REQUEST_RELEASE" }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Browserbase API error closing session ${sessionId} (${resp.status}): ${body}`,
        );
      }
    },
  };
}
