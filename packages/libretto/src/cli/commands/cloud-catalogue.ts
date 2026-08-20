import { SimpleCLI } from "affordance";
import { z } from "zod";
import {
  ApiCallError,
  authFetch,
} from "../core/auth-fetch.js";
import { createCloudJobStatusCommand } from "./cloud-job-status.js";
import { jsonObjectInput } from "./cloud-json-input.js";
import { withCloudApiKey, type CloudApiKeyContext } from "./shared.js";

type WorkflowSummary = {
  id?: string;
  tenant_slug: string | null;
  workflow_name: string | null;
  alias?: string | null;
  description?: string | null;
  default_params?: Record<string, unknown>;
  available?: boolean;
};

type RunJobResponse = {
  job_id: string;
  status: string;
};

async function cloudRestCall<TResult>(opts: {
  ctx: CloudApiKeyContext;
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<TResult> {
  const response = await authFetch({
    apiUrl: opts.ctx.apiUrl,
    credential: opts.ctx.credential,
    method: opts.method ?? "GET",
    path: opts.path,
    body: opts.body === undefined ? undefined : { json: opts.body },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from ${opts.path} (${response.status}). Try the command again.`,
    );
  }
  const envelope =
    data && typeof data === "object" ? (data as { json?: unknown }) : null;
  const result = envelope?.json;
  if (!response.ok) {
    const body = (result ?? data) as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
    };
    throw new ApiCallError({
      message:
        typeof body.error === "string"
          ? body.error
          : typeof body.message === "string"
            ? body.message
            : `${opts.path} failed (${response.status})`,
      status: response.status,
      code: typeof body.code === "string" ? body.code : null,
      data,
      path: opts.path,
    });
  }
  if (!envelope || !("json" in envelope)) {
    throw new Error(
      `Unexpected response from ${opts.path} (${response.status}). Try the command again.`,
    );
  }
  return result as TResult;
}

function printJsonOrLines(
  value: unknown,
  json: boolean,
  lines: string[],
): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  for (const line of lines) console.log(line);
}

async function savedWorkflows(
  ctx: CloudApiKeyContext,
): Promise<WorkflowSummary[]> {
  const response = await cloudRestCall<{ workflows: WorkflowSummary[] }>({
    ctx,
    path: "/v1/catalogue/bookmarks",
  });
  return response.workflows;
}

async function resolveWorkflow(
  ctx: CloudApiKeyContext,
  reference: string,
): Promise<{
  tenantSlug: string;
  workflowName: string;
  defaultParams: Record<string, unknown>;
}> {
  const slash = reference.indexOf("/");
  if (slash > 0 && slash < reference.length - 1) {
    return {
      tenantSlug: reference.slice(0, slash),
      workflowName: reference.slice(slash + 1),
      defaultParams: {},
    };
  }
  const bookmark = (await savedWorkflows(ctx)).find(
    (candidate) => candidate.id === reference || candidate.alias === reference,
  );
  if (
    !bookmark?.available ||
    !bookmark.tenant_slug ||
    !bookmark.workflow_name
  ) {
    throw new Error(
      `Workflow "${reference}" is not an available saved workflow. Run \`libretto cloud catalogue search\`, then use publisher/workflow or save an alias.`,
    );
  }
  return {
    tenantSlug: bookmark.tenant_slug,
    workflowName: bookmark.workflow_name,
    defaultParams: bookmark.default_params ?? {},
  };
}

const workflowReference = SimpleCLI.positional(
  "workflow",
  z.string().optional(),
  {
    help: "Catalogue workflow as publisher/workflow, saved alias, or bookmark id",
  },
);
const jsonFlag = SimpleCLI.flag({ help: "Print machine-readable JSON" });

export const searchCatalogueCommand = SimpleCLI.command({
  description: "Search the Hosted workflow catalogue",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("query", z.string().optional(), {
          help: "Optional name, description, or publisher search",
        }),
      ],
      named: {
        limit: SimpleCLI.option(z.coerce.number().int().min(1).max(50).optional(), {
          help: "Maximum workflows to return (default: 20)",
        }),
        json: jsonFlag,
      },
    }),
  )
  .use(withCloudApiKey("search the workflow catalogue"))
  .handle(async ({ input, ctx }) => {
    const query = new URLSearchParams();
    if (input.query) query.set("q", input.query);
    query.set("limit", String(input.limit ?? 20));
    const response = await cloudRestCall<{ workflows: WorkflowSummary[] }>({
      ctx,
      path: `/v1/catalogue?${query}`,
    });
    printJsonOrLines(
      response,
      input.json,
      response.workflows.length
        ? response.workflows.map(
            (workflow) =>
              `${workflow.tenant_slug}/${workflow.workflow_name}${workflow.description ? ` — ${workflow.description}` : ""}`,
          )
        : ["No catalogue workflows found."],
    );
    return response;
  });

export const getCatalogueWorkflowCommand = SimpleCLI.command({
  description: "Show a catalogue workflow's schema and credential requirements",
})
  .input(
    SimpleCLI.input({
      positionals: [workflowReference],
      named: { json: jsonFlag },
    }).refine(
      (input) => Boolean(input.workflow),
      "Usage: libretto cloud catalogue get <workflow>",
    ),
  )
  .use(withCloudApiKey("inspect catalogue workflows"))
  .handle(async ({ input, ctx }) => {
    const workflow = await resolveWorkflow(ctx, input.workflow!);
    const response = await cloudRestCall<Record<string, unknown>>({
      ctx,
      path: `/v1/catalogue/${encodeURIComponent(workflow.tenantSlug)}/${encodeURIComponent(workflow.workflowName)}`,
    });
    const output = { workflow: response, default_params: workflow.defaultParams };
    printJsonOrLines(output, input.json, [
      `Workflow: ${workflow.tenantSlug}/${workflow.workflowName}`,
      `Description: ${String(response.description ?? "none")}`,
      `Input schema: ${JSON.stringify(response.input_schema ?? null)}`,
      `Output schema: ${JSON.stringify(response.output_schema ?? null)}`,
      `Credentials: ${JSON.stringify(response.credential_requirements ?? [])}`,
    ]);
    return output;
  });

export const runCatalogueWorkflowCommand = SimpleCLI.command({
  description: "Run a catalogue workflow and return its job id",
})
  .input(
    SimpleCLI.input({
      positionals: [workflowReference],
      named: {
        params: SimpleCLI.option(z.string().optional(), {
          help: "Inline JSON params object",
        }),
        paramsFile: SimpleCLI.option(z.string().optional(), {
          name: "params-file",
          help: "Path to a JSON params file",
        }),
        credentials: SimpleCLI.option(z.string().optional(), {
          help: "JSON map of required names to stored credential ids or names",
        }),
        credentialsFile: SimpleCLI.option(z.string().optional(), {
          name: "credentials-file",
          help: "Path to a JSON credential-reference map",
        }),
        timeoutSeconds: SimpleCLI.option(
          z.coerce.number().int().min(1).optional(),
          { name: "timeout-seconds", help: "Job timeout in seconds" },
        ),
        json: jsonFlag,
      },
    }).refine(
      (input) => Boolean(input.workflow),
      "Usage: libretto cloud catalogue run <workflow> [--params <json>]",
    ),
  )
  .use(withCloudApiKey("run catalogue workflows"))
  .handle(async ({ input, ctx }) => {
    const workflow = await resolveWorkflow(ctx, input.workflow!);
    const params = jsonObjectInput(
      "--params",
      input.params,
      "--params-file",
      input.paramsFile,
    );
    const credentials = jsonObjectInput(
      "--credentials",
      input.credentials,
      "--credentials-file",
      input.credentialsFile,
    );
    const response = await cloudRestCall<RunJobResponse>({
      ctx,
      method: "POST",
      path: `/v1/catalogue/run/${encodeURIComponent(workflow.tenantSlug)}/${encodeURIComponent(workflow.workflowName)}`,
      body: {
        params: { ...workflow.defaultParams, ...params },
        ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
        ...(input.timeoutSeconds !== undefined
          ? { timeout_seconds: input.timeoutSeconds }
          : {}),
        skip_callbacks: true,
      },
    });
    printJsonOrLines(response, input.json, [
      `Job: ${response.job_id}`,
      `Status: ${response.status}`,
      `Poll: libretto cloud catalogue status ${response.job_id}`,
    ]);
    return response;
  });

export const statusCatalogueWorkflowCommand = createCloudJobStatusCommand({
  kind: "catalogue",
  namespace: "catalogue",
});

export const saveCatalogueWorkflowCommand = SimpleCLI.command({
  description: "Save a catalogue workflow for this Libretto Cloud workspace",
})
  .input(
    SimpleCLI.input({
      positionals: [workflowReference],
      named: {
        alias: SimpleCLI.option(z.string().optional(), {
          help: "Tenant-unique workflow alias",
        }),
        notes: SimpleCLI.option(z.string().optional(), { help: "Bookmark notes" }),
        defaults: SimpleCLI.option(z.string().optional(), {
          help: "Inline JSON non-secret default params",
        }),
        defaultsFile: SimpleCLI.option(z.string().optional(), {
          name: "defaults-file",
          help: "Path to non-secret default params JSON",
        }),
        json: jsonFlag,
      },
    }).refine(
      (input) => Boolean(input.workflow?.includes("/")),
      "Usage: libretto cloud catalogue save <publisher/workflow>",
    ),
  )
  .use(withCloudApiKey("save catalogue workflows"))
  .handle(async ({ input, ctx }) => {
    const defaultParams = jsonObjectInput(
      "--defaults",
      input.defaults,
      "--defaults-file",
      input.defaultsFile,
    );
    const response = await cloudRestCall<{
      bookmark: { id: string; workflow: string; alias: string | null };
    }>({
      ctx,
      method: "POST",
      path: "/v1/catalogue/bookmarks",
      body: {
        workflow: input.workflow,
        alias: input.alias,
        notes: input.notes,
        default_params: defaultParams,
      },
    });
    printJsonOrLines(response, input.json, [
      `Saved: ${response.bookmark.workflow}`,
      `Bookmark: ${response.bookmark.id}`,
      ...(response.bookmark.alias ? [`Alias: ${response.bookmark.alias}`] : []),
    ]);
    return response;
  });

export const listSavedCatalogueWorkflowsCommand = SimpleCLI.command({
  description: "List catalogue workflows saved by this Libretto Cloud workspace",
})
  .input(
    SimpleCLI.input({ positionals: [], named: { json: jsonFlag } }),
  )
  .use(withCloudApiKey("list saved catalogue workflows"))
  .handle(async ({ input, ctx }) => {
    const workflows = await savedWorkflows(ctx);
    const response = { workflows };
    printJsonOrLines(
      response,
      input.json,
      workflows.length
        ? workflows.map((workflow) => {
            const workflowKey =
              workflow.tenant_slug && workflow.workflow_name
                ? `${workflow.tenant_slug}/${workflow.workflow_name}`
                : "catalogue entry unavailable";
            const name = workflow.alias
              ? `${workflow.alias} (${workflowKey})`
              : workflowKey;
            return `${workflow.id}: ${name}${workflow.available ? "" : " [unavailable]"}`;
          })
        : ["No saved catalogue workflows."],
    );
    return response;
  });

export const removeSavedCatalogueWorkflowCommand = SimpleCLI.command({
  description: "Remove a saved catalogue workflow by bookmark id",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("id", z.string().uuid().optional(), {
          help: "Bookmark id from `libretto cloud catalogue saved`",
        }),
      ],
      named: { json: jsonFlag },
    }).refine(
      (input) => Boolean(input.id),
      "Usage: libretto cloud catalogue remove <bookmark-id>",
    ),
  )
  .use(withCloudApiKey("remove saved catalogue workflows"))
  .handle(async ({ input, ctx }) => {
    const response = await cloudRestCall<{ removed: boolean; id: string }>({
      ctx,
      method: "DELETE",
      path: `/v1/catalogue/bookmarks/${input.id}`,
    });
    printJsonOrLines(response, input.json, [
      response.removed
        ? `Removed bookmark: ${response.id}`
        : `Bookmark ${response.id} was already absent.`,
    ]);
    return response;
  });

export const cloudCatalogueCommands = SimpleCLI.group({
  description: "Discover, run, and save publicly shared workflows",
  routes: {
    search: searchCatalogueCommand,
    get: getCatalogueWorkflowCommand,
    run: runCatalogueWorkflowCommand,
    status: statusCatalogueWorkflowCommand,
    save: saveCatalogueWorkflowCommand,
    saved: listSavedCatalogueWorkflowsCommand,
    remove: removeSavedCatalogueWorkflowCommand,
  },
});
