import type { ProviderApi } from "./types.js";

const DEFAULT_STEEL_API_ENDPOINT = "https://api.steel.dev";
const DEFAULT_STEEL_CONNECT_ENDPOINT = "wss://connect.steel.dev";

type SteelSessionResponse = {
  id: string;
  sessionViewerUrl?: string;
};

export type SteelProviderOptions = {
  apiKey?: string;
};

export function createSteelProvider(
  options: SteelProviderOptions = {},
): ProviderApi {
  const apiKey = options.apiKey ?? process.env.STEEL_API_KEY;
  if (!apiKey) throw new Error("STEEL_API_KEY is required for Steel provider.");

  const endpoint = process.env.STEEL_BASE_URL ?? DEFAULT_STEEL_API_ENDPOINT;
  const connectEndpoint =
    process.env.STEEL_CONNECT_URL ?? DEFAULT_STEEL_CONNECT_ENDPOINT;

  return {
    async createSession() {
      const resp = await fetch(`${endpoint}/v1/sessions`, {
        method: "POST",
        headers: {
          "steel-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Steel API error (${resp.status}): ${body}`);
      }
      const json = (await resp.json()) as SteelSessionResponse;
      return {
        sessionId: json.id,
        cdpEndpoint: buildSteelCdpEndpoint(connectEndpoint, apiKey, json.id),
        liveViewUrl: json.sessionViewerUrl,
      };
    },
    async closeSession(sessionId) {
      const resp = await fetch(`${endpoint}/v1/sessions/${sessionId}/release`, {
        method: "POST",
        headers: {
          "steel-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Steel API error closing session ${sessionId} (${resp.status}): ${body}`,
        );
      }
      return {};
    },
  };
}

function buildSteelCdpEndpoint(
  connectEndpoint: string,
  apiKey: string,
  sessionId: string,
): string {
  const endpoint = new URL(connectEndpoint);
  endpoint.searchParams.set("apiKey", apiKey);
  endpoint.searchParams.set("sessionId", sessionId);
  return endpoint.toString();
}
