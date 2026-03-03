/**
 * Child process entrypoint — runs inside tmux session or foreground.
 *
 * Usage:
 *   bun packages/libretto/src/run/entrypoint.ts \
 *     --registry <path> --job-type <type> --params '<json>' --debug-mode [--headed]
 *
 * 1. If --registry provided, dynamically import the module (side-effect: registers jobs)
 * 2. Resolve job from global registry
 * 3. Validate params via Zod schema
 * 4. Launch browser (headed or headless)
 * 5. Run job handler
 * 6. Exit
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Logger, prettyConsoleSink } from "../logger/index.js";
import { launchBrowser } from "./browser.js";
import { resolveRegisteredJob } from "./registry.js";

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith("--")) return undefined;
  return val;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --- Load job registry ---
  const registryPath = getFlag(args, "--registry");
  if (registryPath) {
    await import(resolve(registryPath));
  }

  const jobType = getFlag(args, "--job-type");
  if (!jobType) throw new Error("Missing --job-type");

  const rawParams = getFlag(args, "--params") ?? "{}";
  let params: unknown;
  try {
    params = JSON.parse(rawParams);
  } catch (e) {
    throw new Error(`Invalid JSON for --params: ${e instanceof Error ? e.message : String(e)}`);
  }

  const headed = hasFlag(args, "--headed");
  const sessionName = process.env.BROWSER_AGENT_SESSION_NAME ?? randomUUID();

  const rootLogger = new Logger([], [prettyConsoleSink]);
  const jobId = randomUUID();
  const job = resolveRegisteredJob(jobType);
  const validatedParams = job.schema.parse(params);

  const logger = rootLogger.withScope("job", { jobId, jobType, sessionName });
  logger.info("job-start", { params: validatedParams, headed });

  const browserSession = await launchBrowser({ sessionName, headless: !headed });
  logger.info("browser-ready", { debugPort: browserSession.debugPort, metadataPath: browserSession.metadataPath });

  try {
    await job.run({ logger, page: browserSession.page, params: validatedParams });
    logger.info("job-success");
  } catch (error) {
    logger.error("job-failure", error);
    throw error;
  } finally {
    await browserSession.close();
    await rootLogger.flush();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
