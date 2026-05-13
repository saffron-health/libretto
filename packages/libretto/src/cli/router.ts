import { authCommands } from "./commands/auth.js";
import { billingCommands } from "./commands/billing.js";
import { browserCommands } from "./commands/browser.js";
import { deployCommand } from "./commands/deploy.js";
import { executionCommands } from "./commands/execution.js";
import { experimentsCommand } from "./commands/experiments.js";
import { setupCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { librettoCommand } from "../shared/package-manager.js";
import { SimpleCLI } from "affordance";

export const cliRoutes = {
  ...browserCommands,
  experimental: SimpleCLI.group({
    description: "Experimental commands",
    routes: {
      deploy: deployCommand,
      auth: authCommands,
      billing: billingCommands,
    },
  }),
  experiments: experimentsCommand,
  ...executionCommands,
  setup: setupCommand,
  status: statusCommand,
  snapshot: snapshotCommand,
};

export function createCLIApp() {
  return SimpleCLI.define(librettoCommand(), cliRoutes);
}
