import {
  readLibrettoConfig,
  type LibrettoConfig,
  writeLibrettoConfig,
} from "./config.js";

export const EXPERIMENTS = {
  exampleExperiment: {
    title: "Example experiment",
    oneSentenceDescription:
      "Example experiment flag for validating experiment plumbing.",
    docs: "Example experiment flag for validating experiment plumbing.",
    defaultValue: false,
  },
  compactSnapshotFormat: {
    title: "Compact snapshot format",
    oneSentenceDescription:
      "Use compact accessibility snapshots and exec page-change diffs without an AI sub-agent.",
    docs: [
      "Compact snapshot format replaces the default snapshot analysis path for daemon-backed sessions while enabled.",
      "",
      "How to enable it:",
      "  1. libretto experiments enable compactSnapshotFormat",
      "  2. Open a new daemon-backed session after enabling the experiment.",
      "     Existing sessions keep the experiment settings they started with.",
      "",
      "Capture a full compact snapshot:",
      "  libretto snapshot --session <name>",
      "",
      "Output includes:",
      "  - Screenshot at <path>",
      "  - A compact accessibility tree with page/frame tags, headings, semantic role tags, and refs such as l16",
      "  - A hint for scoping follow-up snapshots to a subtree",
      "",
      "Inspect a cached subtree:",
      "  libretto snapshot <ref> --session <name>",
      "",
      "Subtree snapshots reuse the latest full compact snapshot cached in the daemon. They capture a fresh screenshot but do not recapture the snapshot tree. Run an unscoped snapshot first; otherwise Libretto reports an error telling you to run libretto snapshot --session <name>.",
      "",
      "Default behavior while disabled:",
      "  libretto snapshot still requires --objective and --context and uses the PNG + HTML + AI analysis path.",
      "",
      "Notes:",
      "  - The experiment is internal CLI/daemon machinery and is not exposed to workflow code.",
      "  - Use ref forms printed in the tree, such as l16. Numeric-suffix aliases such as e16 also match l16.",
      "  - The daemon waits for page stability before full compact snapshot capture; timeout diagnostics are logged as warnings rather than failing the command.",
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
