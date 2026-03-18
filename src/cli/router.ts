import type { Logger } from "../shared/logger/index.js";
import { aiCommands } from "./commands/ai.js";
import { createBrowserCommands } from "./commands/browser.js";
import { createExecutionCommands } from "./commands/execution.js";
import { initCommand } from "./commands/init.js";
import { logCommands } from "./commands/logs.js";
import { sessionOption } from "./commands/shared.js";
import { createSnapshotCommand } from "./commands/snapshot.js";
import { SimpleCLI } from "./framework/simple-cli.js";

export function buildCLIRoutes(logger: Logger) {
  return {
    ...createBrowserCommands(logger),
    ...createExecutionCommands(logger),
    ...logCommands,
    ai: aiCommands,
    init: initCommand,
    snapshot: createSnapshotCommand(logger),
  };
}

export function createCLIApp(logger: Logger) {
  return SimpleCLI.define("libretto", buildCLIRoutes(logger), {
    globalNamed: {
      session: sessionOption(),
    },
  });
}
