import type { ProviderApi } from "./types.js";

export function createSteelProvider(): ProviderApi {
  const apiKey = process.env.STEEL_API_KEY;
  if (!apiKey)
    throw new Error("STEEL_API_KEY is required for Steel provider.");
  const endpoint =
    process.env.STEEL_ENDPOINT ?? "https://api.steel.dev";

  return {
    async createSession() {
      const timeoutMs =
        Number(process.env.STEEL_TIMEOUT_SECONDS ?? 300) * 1000;
      const resp = await fetch(`${endpoint}/v1/sessions`, {
        method: "POST",
        headers: {
          "steel-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeout: timeoutMs,
          useProxy: process.env.STEEL_USE_PROXY !== "false",
          solveCaptcha: process.env.STEEL_SOLVE_CAPTCHA === "true",
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Steel API error (${resp.status}): ${body}`);
      }
      const json = (await resp.json()) as {
        id: string;
        websocketUrl: string;
      };
      return {
        sessionId: json.id,
        cdpEndpoint: json.websocketUrl,
      };
    },
    async closeSession(sessionId) {
      const resp = await fetch(
        `${endpoint}/v1/sessions/${sessionId}/release`,
        {
          method: "POST",
          headers: { "steel-api-key": apiKey },
        },
      );
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Steel API error releasing session ${sessionId} (${resp.status}): ${body}`,
        );
      }
    },
  };
}
