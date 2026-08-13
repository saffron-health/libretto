import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { parseViewportArg } from "./browser.js";
import { createCloudJobStatusCommand } from "./cloud-job-status.js";
import { parseJsonObject, readJsonObjectFile } from "./cloud-json-input.js";
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
    startUrl: SimpleCLI.option(z.string().optional(), {
      name: "start-url",
      help: "Override workflow start URL for browser launch",
    }),
    gpu: SimpleCLI.flag({
      help: "Enable GPU for the browser session (overrides workflow)",
    }),
    viewport: SimpleCLI.option(z.string().optional(), {
      help: "Override browser viewport as WIDTHxHEIGHT",
    }),
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
    disableDefaultProxy: SimpleCLI.flag({
      name: "disable-default-proxy",
      help: "Disable Kernel's default residential stealth proxy (direct egress). Mutually exclusive with --residential-proxy. Needed for sites that fail with ERR_TUNNEL_CONNECTION_FAILED on the default proxy.",
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
  )
  .refine(
    (input) => !(input.disableDefaultProxy && input.residentialProxy),
    "Cannot pass both --disable-default-proxy and --residential-proxy.",
  );

export const createCloudJobCommand = SimpleCLI.command({
  description: "Run one of your tenant's deployed workflows",
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
    const viewport = parseViewportArg(input.viewport);

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
    if (input.startUrl) payload.start_url = input.startUrl;
    if (input.gpu) payload.gpu = true;
    if (viewport) payload.viewport = viewport;
    if (input.callbackUrl) payload.callback_url = input.callbackUrl;
    if (input.callbackSecret) payload.callback_secret = input.callbackSecret;
    if (input.skipCallbacks) payload.skip_callbacks = true;
    if (residentialProxy !== undefined) {
      payload.residential_proxy = residentialProxy;
    }
    if (input.disableDefaultProxy) {
      payload.disable_default_proxy = true;
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
    console.log(`Poll: libretto cloud jobs status ${response.job_id}`);
    return response.job_id;
  });

export const statusCloudJobCommand = createCloudJobStatusCommand({
  kind: "deployed",
  namespace: "jobs",
});

export const cloudJobCommands = SimpleCLI.group({
  description: "Run and inspect your tenant's deployed workflows",
  routes: {
    create: createCloudJobCommand,
    status: statusCloudJobCommand,
  },
});
