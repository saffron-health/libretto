import { authCommands } from "./commands/auth.js";
import { billingCommands } from "./commands/billing.js";
import { browserCommands } from "./commands/browser.js";
import { deployCommand } from "./commands/deploy.js";
import { executionCommands } from "./commands/execution.js";
import { experimentsCommand } from "./commands/experiments.js";
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
    description: "Deploy workflows and manage hosted Libretto",
    routes: {
      deploy: deployCommand,
      auth: authCommands,
      billing: billingCommands,
    },
  }),
  experiments: experimentsCommand,
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
