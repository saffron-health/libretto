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

export const EXPERIMENTS: Readonly<Record<string, ExperimentMetadata>> = {};

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
