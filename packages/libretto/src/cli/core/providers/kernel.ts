import type { ProviderApi } from "./types.js";

const KERNEL_API_ENDPOINT = "https://api.onkernel.com";

export function createKernelProvider(): ProviderApi {
  const apiKey = process.env.KERNEL_API_KEY;
  if (!apiKey)
    throw new Error("KERNEL_API_KEY is required for Kernel provider.");

  return {
    async createSession() {
      const resp = await fetch(`${KERNEL_API_ENDPOINT}/browsers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          headless: process.env.KERNEL_HEADLESS !== "false",
          stealth: process.env.KERNEL_STEALTH === "true",
          timeout_seconds: Number(process.env.KERNEL_TIMEOUT_SECONDS ?? 300),
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Kernel API error (${resp.status}): ${body}`);
      }
      const json = (await resp.json()) as {
        session_id: string;
        cdp_ws_url: string;
      };
      return {
        sessionId: json.session_id,
        cdpEndpoint: json.cdp_ws_url,
      };
    },
    async closeSession(sessionId) {
      const resp = await fetch(`${KERNEL_API_ENDPOINT}/browsers/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(
          `Kernel API error closing session ${sessionId} (${resp.status}): ${body}`,
        );
      }
      return {};
    },
  };
}
