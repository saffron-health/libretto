import { authCommands } from "./commands/auth.js";
import { billingCommands } from "./commands/billing.js";
import { browserCommands } from "./commands/browser.js";
import { cloudCredentialCommands } from "./commands/cloud-credentials.js";
import { cloudJobCommands } from "./commands/cloud-jobs.js";
import { cloudScheduleCommands } from "./commands/cloud-schedules.js";
import { cloudWorkflowCommands } from "./commands/cloud-workflows.js";
import { cloudSmsNumberCommands } from "./commands/cloud-sms-numbers.js";
import { settingsCommands } from "./commands/cloud-settings.js";
import {
  shareWorkflowCommand,
  unshareWorkflowCommand,
} from "./commands/cloud-publishing.js";
import { deployCommand } from "./commands/deploy.js";
import { executionCommands } from "./commands/execution.js";
import { experimentsCommand } from "./commands/experiments.js";
import { importChromeProfilesCommand } from "./commands/import-chrome-profiles.js";
import { profileCommands } from "./commands/profiles.js";
import { setupCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { searchCommand } from "./commands/search.js";
import { telemetryMiddleware } from "./core/telemetry.js";
import { updateCommand } from "./commands/update.js";
import { SimpleCLI } from "affordance";

export const cliRoutes = {
  ...browserCommands,
  cloud: SimpleCLI.group({
    description: "Deploy workflows and manage Libretto Cloud",
    routes: {
      deploy: deployCommand,
      auth: authCommands,
      billing: billingCommands,
      credentials: cloudCredentialCommands,
      jobs: cloudJobCommands,
      profiles: profileCommands,
      schedules: cloudScheduleCommands,
      "sms-numbers": cloudSmsNumberCommands,
      settings: settingsCommands,
      share: shareWorkflowCommand,
      unshare: unshareWorkflowCommand,
      workflows: cloudWorkflowCommands,
    },
  }),
  experiments: experimentsCommand,
  "import-chrome-profiles": importChromeProfilesCommand,
  ...executionCommands,
  search: searchCommand,
  setup: setupCommand,
  status: statusCommand,
  snapshot: snapshotCommand,
  update: updateCommand,
};

export function createCLIApp() {
  return SimpleCLI.define("libretto", cliRoutes, {
    middlewares: [telemetryMiddleware],
    appendHelpText: [
      "Options:",
      "  --session <name>  Required for session-scoped commands",
      "  -h, --help",
      "  -v, --version",
    ].join("\n"),
  });
}
