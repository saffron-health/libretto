import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey, type CloudApiKeyContext } from "./shared.js";

type CodeSharingStatusResponse = {
  enabled: boolean;
};

type ShareWorkflowResponse = {
  id: string;
  status: "created" | "existing" | "refreshed";
  workflow: string;
  open_workflow_url: string;
  code_url: string;
};

type HostWorkflowResponse = {
  hosted_workflow: string;
  page_url: string;
  deployment_version: number;
  status: "created" | "updated";
};

type UnhostWorkflowResponse = {
  hosted_workflow: string;
  notified_consumers: number;
};

export const shareWorkflowCommand = SimpleCLI.command({
  description: "Share one workflow's source as a public open workflow",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("workflow", z.string().min(1), {
        help: "Deployed workflow name to publish as an open workflow",
      }),
    ],
    named: {
      refresh: SimpleCLI.flag({
        help: "Refresh an existing open workflow from the workflow's current deployment",
      }),
    },
  }))
  .use(withCloudApiKey("share Libretto Cloud workflow code"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<ShareWorkflowResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/workflows/share",
      input: {
        workflow: input.workflow,
        refresh: input.refresh,
      },
      credential: ctx.credential,
    });

    if (response.status === "existing") {
      console.log(`Workflow is already shared: ${response.workflow}`);
      console.log("Use --refresh to update the shared code from the current deployment.");
    } else if (response.status === "refreshed") {
      console.log(`Refreshed shared workflow: ${response.workflow}`);
    } else {
      console.log(`Shared workflow: ${response.workflow}`);
    }
    console.log(`Open workflow URL: ${response.open_workflow_url}`);
    console.log(`Code URL: ${response.code_url}`);
    return response.open_workflow_url;
  });

export const hostWorkflowCommand = SimpleCLI.command({
  description: "Publish a deployed workflow as a public hosted workflow",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("workflow", z.string().min(1), {
        help: "Deployed workflow name to publish as a hosted workflow",
      }),
    ],
    named: {
      description: SimpleCLI.option(z.string().optional(), {
        help: "Public description for the hosted workflow",
      }),
    },
  }))
  .use(withCloudApiKey("publish a Libretto Cloud hosted workflow"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<HostWorkflowResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/workflows/host",
      input: {
        workflow: input.workflow,
        description: input.description,
      },
      credential: ctx.credential,
    });
    console.log(
      `${response.status === "created" ? "Published" : "Updated"} hosted workflow: ${response.hosted_workflow}`,
    );
    console.log(`Page URL: ${response.page_url}`);
    console.log(`Deployment version: ${response.deployment_version}`);
    return response.page_url;
  });

export const unhostWorkflowCommand = SimpleCLI.command({
  description: "Remove a workflow from public hosted workflows",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("workflow", z.string().min(1), {
        help: "Deployed workflow name to unhost",
      }),
    ],
    named: {},
  }))
  .use(withCloudApiKey("unhost a Libretto Cloud hosted workflow"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<UnhostWorkflowResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/workflows/unhost",
      input: { workflow: input.workflow },
      credential: ctx.credential,
    });
    console.log(`Unhosted workflow: ${response.hosted_workflow}`);
    console.log(`Notified consumers: ${response.notified_consumers}`);
    return response.hosted_workflow;
  });

export const codeSharingStatusCommand = SimpleCLI.command({
  description: "Show whether tenant workflow sharing is enabled",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage tenant workflow code sharing"))
  .handle(async ({ ctx }) => {
    const response = await orpcCall<CodeSharingStatusResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/tenant/codeSharing",
      input: {},
      credential: ctx.credential,
    });
    console.log(`Workflow sharing: ${response.enabled ? "enabled" : "disabled"}`);
    return response.enabled;
  });

async function updateCodeSharing(
  enabled: boolean,
  ctx: CloudApiKeyContext,
): Promise<boolean> {
  const response = await orpcCall<CodeSharingStatusResponse>({
    apiUrl: ctx.apiUrl,
    path: "/v1/tenant/updateCodeSharing",
    input: { enabled },
    credential: ctx.credential,
  });
  console.log(`Workflow sharing: ${response.enabled ? "enabled" : "disabled"}`);
  return response.enabled;
}

export const enableCodeSharingCommand = SimpleCLI.command({
  description: "Enable public workflow sharing for this tenant",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage tenant workflow code sharing"))
  .handle(async ({ ctx }) => updateCodeSharing(true, ctx));

export const disableCodeSharingCommand = SimpleCLI.command({
  description: "Disable public workflow sharing for this tenant",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage tenant workflow code sharing"))
  .handle(async ({ ctx }) => updateCodeSharing(false, ctx));

export const codeSharingCommands = SimpleCLI.group({
  description: "Manage tenant workflow sharing",
  routes: {
    status: codeSharingStatusCommand,
    enable: enableCodeSharingCommand,
    disable: disableCodeSharingCommand,
  },
});
