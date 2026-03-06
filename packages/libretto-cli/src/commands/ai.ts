import type { Argv } from "yargs";
import { runAiConfigure } from "../core/ai-config.js";

export function registerAICommands(yargs: Argv): Argv {
  return yargs.command(
    "ai configure [preset]",
    "Configure AI runtime",
    (cmd) => cmd.option("clear", { type: "boolean", default: false }),
    (argv) => {
      const customPrefix = Array.isArray(argv["--"]) ? (argv["--"] as string[]) : [];
      runAiConfigure({
        clear: Boolean(argv.clear),
        preset: argv.preset as string | undefined,
        customPrefix,
      }, {
        configureCommandName: "libretto-cli ai configure",
      });
    },
  );
}

