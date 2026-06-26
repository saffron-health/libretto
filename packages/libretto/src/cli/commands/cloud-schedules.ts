import { readFileSync } from "node:fs";
import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey } from "./shared.js";

type ScheduleResponse = {
  id: string;
  workflow: string;
  cron_expr: string;
  timezone: string;
  enabled: boolean;
  next_fire_at: string;
};

type CreateScheduleResponse = {
  success: true;
  schedule: ScheduleResponse;
};

const createScheduleUsage =
  "Usage: libretto cloud schedules create <workflow> --cron <expr> [--params <json> | --params-file <path>]";

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

export const createCloudScheduleInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("workflow", z.string().optional(), {
      help: "Deployed workflow name to schedule",
    }),
  ],
  named: {
    cron: SimpleCLI.option(z.string().optional(), {
      help: "Standard 5-field cron expression",
    }),
    timezone: SimpleCLI.option(z.string().optional(), {
      help: "IANA timezone name (default: UTC)",
    }),
    params: SimpleCLI.option(z.string().optional(), {
      help: "Inline JSON params object",
    }),
    paramsFile: SimpleCLI.option(z.string().optional(), {
      name: "params-file",
      help: "Path to a JSON params file",
    }),
    timeoutSeconds: SimpleCLI.option(z.coerce.number().int().min(1).optional(), {
      name: "timeout-seconds",
      help: "Job timeout in seconds for each schedule fire",
    }),
    callbackUrl: SimpleCLI.option(z.string().optional(), {
      name: "callback-url",
      help: "Per-schedule callback URL",
    }),
    callbackSecret: SimpleCLI.option(z.string().optional(), {
      name: "callback-secret",
      help: "Secret used to sign per-schedule callbacks",
    }),
    skipCallbacks: SimpleCLI.flag({
      name: "skip-callbacks",
      help: "Skip stored webhook callbacks for jobs created by this schedule",
    }),
    residentialProxy: SimpleCLI.option(z.string().optional(), {
      name: "residential-proxy",
      help: "Residential proxy config as a JSON object",
    }),
    disabled: SimpleCLI.flag({
      help: "Create the schedule disabled",
    }),
  },
})
  .refine((input) => Boolean(input.workflow && input.cron), createScheduleUsage)
  .refine(
    (input) => !(input.params && input.paramsFile),
    "Pass either --params or --params-file, not both.",
  )
  .refine(
    (input) =>
      (!input.callbackUrl && !input.callbackSecret) ||
      Boolean(input.callbackUrl && input.callbackSecret),
    "Pass both --callback-url and --callback-secret, or omit both.",
  );

export const createCloudScheduleCommand = SimpleCLI.command({
  description: "Create a recurring schedule for a deployed workflow",
})
  .input(createCloudScheduleInput)
  .use(withCloudApiKey("create Libretto Cloud schedules"))
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
      cron_expr: input.cron!,
      timezone: input.timezone ?? "UTC",
      params,
      enabled: !input.disabled,
    };
    if (input.timeoutSeconds !== undefined) {
      payload.timeout_seconds = input.timeoutSeconds;
    }
    if (input.callbackUrl) payload.callback_url = input.callbackUrl;
    if (input.callbackSecret) payload.callback_secret = input.callbackSecret;
    if (input.skipCallbacks) payload.skip_callbacks = true;
    if (residentialProxy !== undefined) {
      payload.residential_proxy = residentialProxy;
    }

    const response = await orpcCall<CreateScheduleResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/schedules/create",
      input: payload,
      credential: ctx.credential,
    });

    const { schedule } = response;
    console.log(`Schedule created: ${schedule.id}`);
    console.log(`Workflow: ${schedule.workflow}`);
    console.log(`Cron: ${schedule.cron_expr} (${schedule.timezone})`);
    console.log(`Next fire: ${schedule.next_fire_at}`);
    console.log(`Enabled: ${schedule.enabled ? "yes" : "no"}`);
    return schedule.id;
  });

export const cloudScheduleCommands = SimpleCLI.group({
  description: "Create and manage hosted schedules",
  routes: {
    create: createCloudScheduleCommand,
  },
});
