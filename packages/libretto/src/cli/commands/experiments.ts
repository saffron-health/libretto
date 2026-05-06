import { z } from "zod";
import { librettoCommand } from "../../shared/package-manager.js";
import {
  EXPERIMENTS,
  isExperimentName,
  resolveExperiments,
  setExperimentEnabled,
  type ExperimentName,
  type Experiments,
} from "../core/experiments.js";
import { SimpleCLI } from "../framework/simple-cli.js";

const experimentNames = Object.keys(EXPERIMENTS) as ExperimentName[];

const experimentsUsage = [
  "Usage:",
  `  ${librettoCommand("experiments")}`,
  `  ${librettoCommand("experiments describe <experiment>")}`,
  `  ${librettoCommand("experiments enable <experiment>")}`,
  `  ${librettoCommand("experiments disable <experiment>")}`,
].join("\n");

export const experimentsInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("action", z.string().optional(), {
      help: "Action to apply",
    }),
    SimpleCLI.positional("experiment", z.string().optional(), {
      help: "Experiment name",
    }),
  ],
  named: {},
});

function formatAvailableExperiments(): string {
  return [
    "Available experiments:",
    ...experimentNames.map((name) => `  ${name}`),
  ].join("\n");
}

function experimentUsageError(message: string): Error {
  return new Error(
    [message, "", experimentsUsage, "", formatAvailableExperiments()].join(
      "\n",
    ),
  );
}

function printExperiments(experiments: Experiments): void {
  console.log("Libretto experiments:");
  for (const name of experimentNames) {
    const metadata = EXPERIMENTS[name];
    console.log(
      `- ${name}: ${experiments[name] ? "enabled" : "disabled"} — ${metadata.title}`,
    );
    console.log(`  ${metadata.oneSentenceDescription}`);
  }
}

function printExperimentDescription(name: ExperimentName): void {
  const metadata = EXPERIMENTS[name];
  console.log(`${metadata.title} (${name})`);
  console.log("");
  console.log(metadata.docs);
}

export const experimentsCommand = SimpleCLI.command({
  description: "List or update Libretto experiment flags",
})
  .input(experimentsInput)
  .handle(async ({ input }) => {
    if (!input.action) {
      printExperiments(resolveExperiments());
      return;
    }

    if (
      input.action !== "describe" &&
      input.action !== "enable" &&
      input.action !== "disable"
    ) {
      throw experimentUsageError(`Unknown experiments action "${input.action}".`);
    }

    if (!input.experiment) {
      throw experimentUsageError(
        `Missing experiment name for ${input.action}.`,
      );
    }

    if (!isExperimentName(input.experiment)) {
      throw experimentUsageError(`Unknown experiment "${input.experiment}".`);
    }

    if (input.action === "describe") {
      printExperimentDescription(input.experiment);
      return;
    }

    setExperimentEnabled(input.experiment, input.action === "enable");
    console.log(`Experiment "${input.experiment}" ${input.action}d.`);
  });
