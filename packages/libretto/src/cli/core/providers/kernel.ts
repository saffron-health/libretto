import type { ProviderApi } from "./types.js";

export type KernelProviderOptions = {
  apiKey?: string;
  headless?: boolean;
  stealth?: boolean;
  timeoutSeconds?: number;
  enableRecording?: boolean;
};

type KernelBrowserResponse = {
  session_id: string;
  cdp_ws_url: string;
  browser_live_view_url?: string | null;
};

type KernelReplayResponse = {
  replay_id: string;
  replay_view_url?: string | null;
};

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes";
}

function readTimeoutSeconds(options: KernelProviderOptions): number {
  if (options.timeoutSeconds !== undefined) return options.timeoutSeconds;
  return Number(process.env.KERNEL_TIMEOUT_SECONDS ?? 300);
}

async function kernelFetchJson<T>(
  endpoint: string,
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const resp = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Kernel API error (${resp.status}): ${body}`);
  }
  return (await resp.json()) as T;
}

async function kernelFetchNoBody(
  endpoint: string,
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<void> {
  const resp = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Kernel API error (${resp.status}): ${body}`);
  }
}

function readEndpoint(): string {
  return (
    process.env.KERNEL_API_ENDPOINT?.trim() ||
    process.env.KERNEL_ENDPOINT?.trim() ||
    "https://api.onkernel.com"
  );
}

export function createKernelProvider(
  options: KernelProviderOptions = {},
): ProviderApi {
  const apiKey = options.apiKey ?? process.env.KERNEL_API_KEY;
  if (!apiKey)
    throw new Error("KERNEL_API_KEY is required for Kernel provider.");
  const endpoint = readEndpoint();
  const headless = options.headless ?? process.env.KERNEL_HEADLESS !== "false";
  const stealth = options.stealth ?? readBooleanEnv("KERNEL_STEALTH", false);
  const timeoutSeconds = readTimeoutSeconds(options);
  const enableRecording =
    options.enableRecording ?? readBooleanEnv("KERNEL_ENABLE_RECORDING", false);
  const replays = new Map<
    string,
    {
      replayId: string;
      replayViewUrl?: string;
    }
  >();

  return {
    async createSession(sessionOptions) {
      const sessionHeadless = sessionOptions?.headless ?? headless;
      const startUrl = sessionOptions?.startUrl?.trim() || undefined;
      const gpu = sessionOptions?.gpu;
      const viewport = sessionOptions?.viewport;
      const json = await kernelFetchJson<KernelBrowserResponse>(
        endpoint,
        apiKey,
        "/browsers",
        {
          method: "POST",
          body: JSON.stringify({
            headless: sessionHeadless,
            stealth,
            timeout_seconds: timeoutSeconds,
            ...(startUrl ? { start_url: startUrl } : {}),
            ...(gpu !== undefined ? { gpu } : {}),
            ...(viewport
              ? {
                  viewport: {
                    width: viewport.width,
                    height: viewport.height,
                  },
                }
              : {}),
          }),
        },
      );

      let replay: KernelReplayResponse | undefined;
      if (enableRecording) {
        try {
          replay = await kernelFetchJson<KernelReplayResponse>(
            endpoint,
            apiKey,
            `/browsers/${json.session_id}/replays`,
            { method: "POST", body: JSON.stringify({}) },
          );
          replays.set(json.session_id, {
            replayId: replay.replay_id,
            replayViewUrl: replay.replay_view_url ?? undefined,
          });
        } catch (error) {
          await kernelFetchNoBody(
            endpoint,
            apiKey,
            `/browsers/${json.session_id}`,
            { method: "DELETE" },
          ).catch(() => {});
          throw error;
        }
      }

      return {
        sessionId: json.session_id,
        cdpEndpoint: json.cdp_ws_url,
        liveViewUrl: json.browser_live_view_url ?? undefined,
        recordingUrl: replay?.replay_view_url ?? undefined,
        startUrlPreloaded: Boolean(startUrl),
      };
    },
    async closeSession(sessionId) {
      const replay = replays.get(sessionId);
      let replayStopError: unknown;
      if (replay) {
        try {
          await kernelFetchNoBody(
            endpoint,
            apiKey,
            `/browsers/${sessionId}/replays/${replay.replayId}/stop`,
            { method: "POST" },
          );
        } catch (error) {
          replayStopError = error;
        }
      }

      await kernelFetchNoBody(endpoint, apiKey, `/browsers/${sessionId}`, {
        method: "DELETE",
      });
      replays.delete(sessionId);

      if (replayStopError) {
        throw replayStopError;
      }
      return { replayUrl: replay?.replayViewUrl };
    },
  };
}
