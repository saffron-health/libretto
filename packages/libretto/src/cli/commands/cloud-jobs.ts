import { readFileSync } from "node:fs";
import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey } from "./shared.js";

type JobStatus = "queued" | "starting_browser" | "running";

type CreateJobResponse = {
  success: true;
  job_id: string;
  status: JobStatus;
  message: string;
};

const createJobUsage =
  "Usage: libretto cloud jobs create <workflow> [--params <json> | --params-file <path>]";

function parseJsonObject(label: string, raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function readJsonObjectFile(
  label: string,
  filePath: string,
): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      `Could not read ${label} "${filePath}". Ensure the file exists and is readable.`,
    );
  }
  return parseJsonObject(label, content);
}

export const createCloudJobInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("workflow", z.string().optional(), {
      help: "Deployed workflow name to run",
    }),
  ],
  named: {
    params: SimpleCLI.option(z.string().optional(), {
      help: "Inline JSON params object",
    }),
    paramsFile: SimpleCLI.option(z.string().optional(), {
      name: "params-file",
      help: "Path to a JSON params file",
    }),
    credentialId: SimpleCLI.option(z.string().optional(), {
      name: "credential-id",
      help: "Stored cloud credential id to pass to the workflow",
    }),
    timeoutSeconds: SimpleCLI.option(z.coerce.number().int().min(1).optional(), {
      name: "timeout-seconds",
      help: "Job timeout in seconds",
    }),
    headed: SimpleCLI.flag({ help: "Run browser in headed mode" }),
    headless: SimpleCLI.flag({ help: "Run browser in headless mode" }),
    callbackUrl: SimpleCLI.option(z.string().optional(), {
      name: "callback-url",
      help: "Per-job callback URL",
    }),
    callbackSecret: SimpleCLI.option(z.string().optional(), {
      name: "callback-secret",
      help: "Secret used to sign the per-job callback",
    }),
    skipCallbacks: SimpleCLI.flag({
      name: "skip-callbacks",
      help: "Skip stored webhook callbacks for this job",
    }),
    residentialProxy: SimpleCLI.option(z.string().optional(), {
      name: "residential-proxy",
      help: "Residential proxy config as a JSON object",
    }),
  },
})
  .refine((input) => Boolean(input.workflow), createJobUsage)
  .refine(
    (input) => !(input.params && input.paramsFile),
    "Pass either --params or --params-file, not both.",
  )
  .refine(
    (input) => !(input.headed && input.headless),
    "Cannot pass both --headed and --headless.",
  )
  .refine(
    (input) =>
      (!input.callbackUrl && !input.callbackSecret) ||
      Boolean(input.callbackUrl && input.callbackSecret),
    "Pass both --callback-url and --callback-secret, or omit both.",
  );

export const createCloudJobCommand = SimpleCLI.command({
  description: "Create a Libretto Cloud job for a deployed workflow",
})
  .input(createCloudJobInput)
  .use(withCloudApiKey("create Libretto Cloud jobs"))
  .handle(async ({ input, ctx }) => {
    const params = input.paramsFile
      ? readJsonObjectFile("--params-file", input.paramsFile)
      : input.params
        ? parseJsonObject("--params", input.params)
        : {};
    const residentialProxy = input.residentialProxy
      ? parseJsonObject("--residential-proxy", input.residentialProxy)
      : undefined;

    const payload: Record<string, unknown> = {
      workflow: input.workflow!,
      params,
    };
    if (input.credentialId) payload.credential_id = input.credentialId;
    if (input.timeoutSeconds !== undefined) {
      payload.timeout_seconds = input.timeoutSeconds;
    }
    if (input.headed) payload.headless = false;
    if (input.headless) payload.headless = true;
    if (input.callbackUrl) payload.callback_url = input.callbackUrl;
    if (input.callbackSecret) payload.callback_secret = input.callbackSecret;
    if (input.skipCallbacks) payload.skip_callbacks = true;
    if (residentialProxy !== undefined) {
      payload.residential_proxy = residentialProxy;
    }

    const response = await orpcCall<CreateJobResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/jobs/create",
      input: payload,
      credential: ctx.credential,
    });

    console.log(`Job created: ${response.job_id}`);
    console.log(`Status: ${response.status}`);
    console.log(response.message);
    return response.job_id;
  });

export const cloudJobCommands = SimpleCLI.group({
  description: "Create and manage hosted jobs",
  routes: {
    create: createCloudJobCommand,
  },
});
