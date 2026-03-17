import { z } from "zod";
import { runAiConfigure } from "../core/ai-config.js";
import { SimpleCLI } from "../framework/simple-cli.js";

export const aiConfigureInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("preset", z.string().optional(), {
      help: "Provider shorthand or provider/model-id",
    }),
  ],
  named: {
    clear: SimpleCLI.flag({ help: "Clear existing AI config" }),
  },
});

export const aiCommands = SimpleCLI.group({
  description: "AI commands",
  routes: {
    configure: SimpleCLI.command({
      description: "Configure AI runtime",
    })
      .input(aiConfigureInput)
      .handle(async ({ input }) => {
        runAiConfigure(
          {
            clear: input.clear,
            preset: input.preset,
          },
          {
            configureCommandName: `libretto ai configure`,
          },
        );
      }),
  },
});
