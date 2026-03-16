import type { Argv } from "yargs";
import { runAiConfigure } from "../core/ai-config.js";

export function registerAICommands(yargs: Argv): Argv {
  return yargs.command(
    "ai configure [preset]",
    "Configure AI model for snapshot analysis",
    (cmd) => cmd.option("clear", { type: "boolean", default: false }),
    (argv) => {
      runAiConfigure({
        clear: Boolean(argv.clear),
        preset: argv.preset as string | undefined,
      }, {
        configureCommandName: "npx libretto ai configure",
      });
    },
  );
}
