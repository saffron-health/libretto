import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Logger, prettyConsoleSink } from "../logger/index.js";
import { launchBrowser } from "./browser.js";
import { resolveRegisteredJob } from "./registry.js";

export type RunRegisteredJobInput = {
  jobType: string;
  params?: unknown;
  sessionName?: string;
  jobId?: string;
};

function getOptionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseParams(args: string[]): unknown {
  const rawInline = getOptionValue(args, "--params");
  const paramsFile = getOptionValue(args, "--params-file");
  if (rawInline && paramsFile) throw new Error("Pass either --params or --params-file, not both.");
  const raw = paramsFile ? readFileSync(paramsFile, "utf8") : rawInline;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON for params: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseRuntimeArgs(args: string[]): RunRegisteredJobInput {
  const [jobType] = args;
  if (!jobType || jobType.startsWith("--")) {
    throw new Error("Usage: <jobType> [--params <json> | --params-file <path>] [--session <name>] [--job-id <id>]");
  }
  return {
    jobType,
    params: parseParams(args),
    sessionName: getOptionValue(args, "--session"),
    jobId: getOptionValue(args, "--job-id"),
  };
}

export async function runRegisteredJob(input: RunRegisteredJobInput): Promise<void> {
  const rootLogger = new Logger([], [prettyConsoleSink]);
  const jobId = input.jobId ?? randomUUID();
  const sessionName = input.sessionName ?? randomUUID();
  const job = resolveRegisteredJob(input.jobType);
  const params = job.schema.parse(input.params ?? {});

  const logger = rootLogger.withScope("job", { jobId, jobType: input.jobType, sessionName });
  logger.info("job-start", { params });

  const browserSession = await launchBrowser({ sessionName });
  logger.info("browser-ready", { debugPort: browserSession.debugPort, metadataPath: browserSession.metadataPath });

  try {
    await job.run({ logger, page: browserSession.page, params });
    logger.info("job-success");
  } catch (error) {
    logger.error("job-failure", error);
    throw error;
  } finally {
    await browserSession.close();
    await rootLogger.flush();
  }
}
