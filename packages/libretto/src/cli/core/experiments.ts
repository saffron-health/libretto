import {
  readLibrettoConfig,
  type LibrettoConfig,
  writeLibrettoConfig,
} from "./config.js";

export type ExperimentMetadata = {
  title: string;
  oneSentenceDescription: string;
  docs?: string;
  defaultValue: boolean;
};

export const EXPERIMENTS: Readonly<Record<string, ExperimentMetadata>> = {
  search: {
    title: "HTML Search",
    oneSentenceDescription:
      "Adds a search command that greps the current page's formatted HTML snapshot.",
    docs: [
      "Adds a search command for inspecting the current page's HTML snapshot with a JavaScript regex.",
      "",
      "Usage: libretto search <regex> --session <name> [--page <id>]",
      "",
      "The command captures page HTML through read-only execution, condenses and formats it, then prints matching regions with up to four lines of surrounding context.",
    ].join("\n"),
    defaultValue: false,
  },
};

export type ExperimentName = string;
export type Experiments = Record<ExperimentName, boolean>;

export function isExperimentName(name: string): name is ExperimentName {
  return Object.hasOwn(EXPERIMENTS, name);
}

export function resolveExperiments(
  config: LibrettoConfig = readLibrettoConfig(),
): Experiments {
  return Object.fromEntries(
    Object.entries(EXPERIMENTS).map(([name, metadata]) => [
      name,
      config.experiments?.[name] ?? metadata.defaultValue,
    ]),
  ) as Experiments;
}

export function setExperimentEnabled(
  name: string,
  enabled: boolean,
  configPath?: string,
): Experiments {
  if (!isExperimentName(name)) {
    throw new Error(`Unknown experiment "${name}".`);
  }

  const config = readLibrettoConfig(configPath);
  const writtenConfig = writeLibrettoConfig(
    {
      ...config,
      experiments: {
        ...config.experiments,
        [name]: enabled,
      },
    },
    configPath,
  );

  return resolveExperiments(writtenConfig);
}
