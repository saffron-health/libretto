import { aiCommands } from "./commands/ai.js";
import { browserCommands } from "./commands/browser.js";
import { deployCommand } from "./commands/deploy.js";
import { executionCommands } from "./commands/execution.js";
import { initCommand } from "./commands/init.js";
import { logCommands } from "./commands/logs.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { SimpleCLI } from "./framework/simple-cli.js";

export const cliRoutes = {
  ...browserCommands,
  ...executionCommands,
  ...logCommands,
  ai: aiCommands,
  cloud: SimpleCLI.group({
    description: "Hosted Libretto Cloud commands",
    routes: {
      deploy: deployCommand,
    },
  }),
  init: initCommand,
  snapshot: snapshotCommand,
};

export function createCLIApp() {
  return SimpleCLI.define("libretto", cliRoutes);
}
