import {
  readLibrettoConfig,
  type LibrettoConfig,
  writeLibrettoConfig,
} from "./config.js";

export const EXPERIMENTS = {
  "compact-snapshot-format": {
    title: "Compact snapshot format",
    oneSentenceDescription:
      "Use compact accessibility snapshots and exec page-change diffs without an AI sub-agent.",
    docs: [
      "Compact snapshot format changes how agents should use snapshot and exec after the experiment is enabled.",
      "",
      "Compared with the skill's documented behavior:",
      "  - Run libretto snapshot --session <name> without --objective or --context.",
      "  - Snapshot output is a screenshot path plus a compact accessibility tree; it does not use the PNG + HTML + AI analysis path.",
      "  - Run libretto snapshot <ref> --session <name> to inspect a subtree from the latest full compact snapshot.",
      "  - Run libretto exec normally; after successful mutations, Libretto prints page-change diffs from compact snapshots without AI analysis.",
      "  - If a session was already open before enabling the experiment, close and reopen it before relying on this behavior.",
      "",
      "Full compact snapshot:",
      "  libretto snapshot --session <name>",
      "",
      "Cached subtree snapshot:",
      "  libretto snapshot <ref> --session <name>",
      "",
      "Run an unscoped snapshot before using refs. Subtree snapshots capture a fresh screenshot but reuse the latest cached tree.",
      "",
      "Notes:",
      "  - Use ref forms printed in the tree, such as l16. Numeric-suffix aliases such as e16 also match l16.",
    ].join("\n"),
    defaultValue: false,
  },
} as const satisfies Record<
  string,
  {
    title: string;
    oneSentenceDescription: string;
    docs?: string;
    defaultValue: boolean;
  }
>;

export type ExperimentName = keyof typeof EXPERIMENTS;
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
