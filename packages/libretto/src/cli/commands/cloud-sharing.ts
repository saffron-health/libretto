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
  marketplace_url: string;
  code_url: string;
};

export const shareWorkflowCommand = SimpleCLI.command({
  description: "Share one hosted workflow's code publicly",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("workflow", z.string().min(1), {
        help: "Hosted workflow name to share",
      }),
    ],
    named: {
      refresh: SimpleCLI.flag({
        help: "Refresh an existing share from the workflow's current deployment",
      }),
    },
  }))
  .use(withCloudApiKey("share Libretto Cloud workflow code"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<ShareWorkflowResponse>({
      apiUrl: ctx.apiUrl,
      path: "/v1/workflows/share",
      input: { workflow: input.workflow, refresh: input.refresh },
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
    console.log(`Marketplace URL: ${response.marketplace_url}`);
    console.log(`Code URL: ${response.code_url}`);
    return response.marketplace_url;
  });

export const codeSharingStatusCommand = SimpleCLI.command({
  description: "Show whether tenant code sharing is enabled",
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
    console.log(`Code sharing: ${response.enabled ? "enabled" : "disabled"}`);
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
  console.log(`Code sharing: ${response.enabled ? "enabled" : "disabled"}`);
  return response.enabled;
}

export const enableCodeSharingCommand = SimpleCLI.command({
  description: "Enable public workflow code sharing for this tenant",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage tenant workflow code sharing"))
  .handle(async ({ ctx }) => updateCodeSharing(true, ctx));

export const disableCodeSharingCommand = SimpleCLI.command({
  description: "Disable public workflow code sharing for this tenant",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage tenant workflow code sharing"))
  .handle(async ({ ctx }) => updateCodeSharing(false, ctx));

export const codeSharingCommands = SimpleCLI.group({
  description: "Manage tenant workflow code sharing",
  routes: {
    status: codeSharingStatusCommand,
    enable: enableCodeSharingCommand,
    disable: disableCodeSharingCommand,
  },
});
