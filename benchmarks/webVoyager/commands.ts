import { z } from "zod";
import { SimpleCLI } from "../libretto-internals.js";
import { runWebVoyagerBenchmark } from "./runner.js";

const webVoyagerRunInput = SimpleCLI.input({
  positionals: [],
  named: {
    offset: SimpleCLI.option(z.coerce.number().int().nonnegative().optional(), {
      help: "Start at this case index for contiguous runs",
    }),
    count: SimpleCLI.option(z.coerce.number().int().positive().optional(), {
      help: "Number of cases to run",
    }),
    seed: SimpleCLI.option(z.coerce.number().int().optional(), {
      help: "Seed for random selection (default: 1)",
    }),
    random: SimpleCLI.flag({
      help: "Select a seeded random sample instead of a contiguous slice",
    }),
  },
})
  .refine(
    (input) => !input.random || input.offset == null,
    "--offset cannot be used with --random.",
  )
  .refine(
    (input) => input.random || input.seed == null,
    "--seed requires --random.",
  );

export const webVoyagerCommands = SimpleCLI.group({
  description: "WebVoyager benchmark commands",
  routes: {
    run: SimpleCLI.command({
      description: "Run WebVoyager benchmark cases",
    })
      .input(webVoyagerRunInput)
      .handle(async ({ input }) =>
        runWebVoyagerBenchmark({
          offset: input.offset,
          count: input.count,
          seed: input.seed,
          random: input.random,
        }),
      ),
  },
});
