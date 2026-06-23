import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey, type CloudApiKeyContext } from "./shared.js";

type TenantSettingsResponse = {
  code_sharing_enabled: boolean;
  disable_job_failure_notifications: boolean;
  debug_notification_email: string | null;
};

type TenantSettingsInput = {
  code_sharing_enabled?: boolean;
  disable_job_failure_notifications?: boolean;
};

const settingState = z.enum(["enabled", "disabled"]);

function toBoolean(state: "enabled" | "disabled"): boolean {
  return state === "enabled";
}

function printTenantSettings(
  settings: TenantSettingsResponse,
): TenantSettingsResponse {
  const notificationsEnabled = !settings.disable_job_failure_notifications;
  console.log(
    `Code sharing: ${settings.code_sharing_enabled ? "enabled" : "disabled"}`,
  );
  console.log(
    `Job failure notifications: ${notificationsEnabled ? "enabled" : "disabled"}`,
  );
  console.log(
    `Notification recipient: ${settings.debug_notification_email ?? "not configured"}`,
  );
  return settings;
}

async function tenantSettings(
  ctx: CloudApiKeyContext,
  input: TenantSettingsInput = {},
): Promise<TenantSettingsResponse> {
  return orpcCall<TenantSettingsResponse>({
    apiUrl: ctx.apiUrl,
    path: "/v1/tenant/settings",
    input,
    credential: ctx.credential,
  });
}

export const settingsStatusCommand = SimpleCLI.command({
  description: "Show Libretto Cloud tenant settings",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .use(withCloudApiKey("manage Libretto Cloud settings"))
  .handle(async ({ ctx }) => printTenantSettings(await tenantSettings(ctx)));

export const setSettingsCommand = SimpleCLI.command({
  description: "Update one or more Libretto Cloud tenant settings",
})
  .input(
    SimpleCLI.input({
      positionals: [],
      named: {
        codeSharing: SimpleCLI.option(settingState.optional(), {
          help: "Set tenant code sharing: enabled or disabled",
        }),
        jobFailureNotifications: SimpleCLI.option(settingState.optional(), {
          help: "Set hosted job failure notification emails: enabled or disabled",
        }),
      },
    }),
  )
  .use(withCloudApiKey("manage Libretto Cloud settings"))
  .handle(async ({ input, ctx }) => {
    const updates: TenantSettingsInput = {};
    if (input.codeSharing !== undefined) {
      updates.code_sharing_enabled = toBoolean(input.codeSharing);
    }
    if (input.jobFailureNotifications !== undefined) {
      updates.disable_job_failure_notifications = !toBoolean(
        input.jobFailureNotifications,
      );
    }

    if (Object.keys(updates).length === 0) {
      throw new Error(
        "No settings provided. Use one or more flags, for example `libretto cloud settings set --code-sharing enabled --job-failure-notifications disabled`.",
      );
    }

    return printTenantSettings(await tenantSettings(ctx, updates));
  });

export const settingsCommands = SimpleCLI.group({
  description: "Manage Libretto Cloud tenant settings",
  routes: {
    status: settingsStatusCommand,
    set: setSettingsCommand,
  },
});
