/**
 * Benchmark-owned Kernel browser session bootstrap.
 *
 * Creates and destroys Kernel-backed browser sessions, primes them at a
 * start URL, and registers them with the local Libretto CLI via
 * `libretto connect` so that `snapshot`, `exec`, and `pages` work
 * transparently against the remote browser.
 */

import Kernel from "@onkernel/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { GoogleAuth } from "google-auth-library";
import {
  SESSION_STATE_VERSION,
  type SessionStateFile,
} from "../../packages/libretto/src/shared/state/session-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KernelSessionHandle = {
  kernelSessionId: string;
  cdpEndpoint: string;
  liveViewUrl: string | null;
};

type KernelSessionMetadata = {
  kernelSessionId: string;
  cdpEndpoint: string;
  liveViewUrl: string | null;
  createdAt: string;
  startUrl: string;
  sessionName: string;
  timeoutSeconds: number;
  stealth: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GCP_PROJECT = "saffron-health";
const DEFAULT_KERNEL_SECRET_NAME = "kernel-api-key-libretto-benchmarks";
const KERNEL_SESSION_TIMEOUT_SECONDS = 7200; // 2 hours
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Kernel API key management
// ---------------------------------------------------------------------------

async function accessSecretVersion(args: {
  projectId: string;
  secretName: string;
}): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const { data } = await client.request<{ payload?: { data?: string } }>({
    url: `https://secretmanager.googleapis.com/v1/projects/${args.projectId}/secrets/${args.secretName}/versions/latest:access`,
    method: "GET",
  });

  const encoded = data.payload?.data?.trim();
  if (!encoded) {
    throw new Error(
      `Secret ${args.secretName} in project ${args.projectId} did not return a payload.`,
    );
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!decoded) {
    throw new Error(
      `Secret ${args.secretName} in project ${args.projectId} decoded to an empty string.`,
    );
  }

  return decoded;
}

/**
 * Resolve `KERNEL_API_KEY` from the environment or GCP Secret Manager.
 * Throws an actionable error when Kernel mode is selected without credentials.
 */
export async function ensureKernelApiKey(): Promise<string> {
  const existing = process.env.KERNEL_API_KEY?.trim();
  if (existing) {
    return existing;
  }

  // Try GCP Secret Manager
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const projectId =
      process.env.LIBRETTO_BENCHMARK_GCP_PROJECT?.trim() ||
      (await auth.getProjectId()) ||
      DEFAULT_GCP_PROJECT;
    const secretName =
      process.env.LIBRETTO_BENCHMARK_KERNEL_SECRET_NAME?.trim() ||
      DEFAULT_KERNEL_SECRET_NAME;

    const apiKey = await accessSecretVersion({ projectId, secretName });
    process.env.KERNEL_API_KEY = apiKey;
    return apiKey;
  } catch (err) {
    throw new Error(
      `Kernel mode requires KERNEL_API_KEY. Set it in the environment or ensure ` +
        `the GCP secret "${DEFAULT_KERNEL_SECRET_NAME}" is accessible.\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Kernel metadata
// ---------------------------------------------------------------------------

/**
 * Write a benchmark-owned metadata file for debugging and cleanup.
 */
async function writeKernelMetadata(
  runDir: string,
  metadata: KernelSessionMetadata,
): Promise<void> {
  await writeFile(
    join(runDir, "kernel-session.json"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// CDP priming
// ---------------------------------------------------------------------------

/**
 * Connect to the Kernel browser over CDP and navigate to the start URL.
 * Uses the existing default page/context rather than creating a new one.
 */
async function primeSessionAtUrl(
  cdpEndpoint: string,
  startUrl: string,
): Promise<void> {
  const browser = await chromium.connectOverCDP(cdpEndpoint, {
    timeout: 30_000,
  });

  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error(
        "Kernel browser has no default context after creation. Cannot prime session.",
      );
    }

    const pages = contexts[0].pages();
    const page = pages.length > 0 ? pages[0] : await contexts[0].newPage();

    await page.goto(startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } finally {
    // Disconnect Playwright but do NOT close the remote browser
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Libretto session state
// ---------------------------------------------------------------------------

/**
 * Write a Libretto-compatible `.libretto/sessions/<session>/state.json`
 * directly into the run workspace. This is the same file that
 * `libretto connect` would write, but avoids shelling out to the CLI
 * (the isolated run workspace doesn't have full node_modules).
 */
async function writeLibrettoSessionState(
  runDir: string,
  sessionName: string,
  cdpEndpoint: string,
): Promise<void> {
  const sessionDir = join(runDir, ".libretto", "sessions", sessionName);
  await mkdir(sessionDir, { recursive: true });

  let port = 443;
  try {
    const parsed = new URL(cdpEndpoint);
    if (parsed.port) {
      port = Number.parseInt(parsed.port, 10);
    } else if (parsed.protocol === "ws:") {
      port = 80;
    }
  } catch {
    // keep default
  }

  const state: SessionStateFile = {
    version: SESSION_STATE_VERSION,
    port,
    cdpEndpoint,
    session: sessionName,
    startedAt: new Date().toISOString(),
    status: "active",
    viewport: DEFAULT_VIEWPORT,
  };

  await writeFile(
    join(sessionDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Kernel browser session, navigate to the start URL, and register
 * it as a named Libretto session via `libretto connect`.
 */
export async function openKernelSessionForBenchmark(args: {
  runDir: string;
  sessionName: string;
  startUrl: string;
}): Promise<KernelSessionHandle> {
  const apiKey = await ensureKernelApiKey();
  const kernel = new Kernel({ apiKey });

  const kernelBrowser = await kernel.browsers.create({
    stealth: true,
    headless: false,
    timeout_seconds: KERNEL_SESSION_TIMEOUT_SECONDS,
    viewport: {
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
    },
  });

  const handle: KernelSessionHandle = {
    kernelSessionId: kernelBrowser.session_id,
    cdpEndpoint: kernelBrowser.cdp_ws_url,
    liveViewUrl: kernelBrowser.browser_live_view_url ?? null,
  };

  try {
    // Navigate to start URL
    await primeSessionAtUrl(handle.cdpEndpoint, args.startUrl);

    // Write Libretto session state so snapshot/exec/pages work
    await writeLibrettoSessionState(
      args.runDir,
      args.sessionName,
      handle.cdpEndpoint,
    );

    // Write kernel metadata for debugging/cleanup
    await writeKernelMetadata(args.runDir, {
      kernelSessionId: handle.kernelSessionId,
      cdpEndpoint: handle.cdpEndpoint,
      liveViewUrl: handle.liveViewUrl,
      createdAt: new Date().toISOString(),
      startUrl: args.startUrl,
      sessionName: args.sessionName,
      timeoutSeconds: KERNEL_SESSION_TIMEOUT_SECONDS,
      stealth: true,
    });

    if (handle.liveViewUrl) {
      console.log(`Kernel live view: ${handle.liveViewUrl}`);
    }

    return handle;
  } catch (err) {
    // Clean up the Kernel session if priming or connect fails
    try {
      await kernel.browsers.deleteByID(handle.kernelSessionId);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Delete a Kernel browser session. Idempotent — silently succeeds if the
 * session has already been deleted or timed out.
 */
export async function closeKernelSessionForBenchmark(
  handle: KernelSessionHandle,
): Promise<void> {
  try {
    const apiKey = await ensureKernelApiKey();
    const kernel = new Kernel({ apiKey });
    await kernel.browsers.deleteByID(handle.kernelSessionId);
  } catch (err) {
    // Log but don't throw — session may already be gone
    console.warn(
      `Warning: failed to delete Kernel session ${handle.kernelSessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
