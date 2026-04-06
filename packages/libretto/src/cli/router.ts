import { aiCommands } from "./commands/ai.js";
import { browserCommands } from "./commands/browser.js";
import { deployCommand } from "./commands/deploy.js";
import { executionCommands } from "./commands/execution.js";
import { setupCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { SimpleCLI } from "./framework/simple-cli.js";

export const cliRoutes = {
  ...browserCommands,
  deploy: deployCommand,
  ...executionCommands,
  ai: aiCommands,
  setup: setupCommand,
  status: statusCommand,
  snapshot: snapshotCommand,
};

export function createCLIApp() {
  return SimpleCLI.define("libretto", cliRoutes);
}
