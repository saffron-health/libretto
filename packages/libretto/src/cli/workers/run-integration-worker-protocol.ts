import type { RunDebugPauseDetails } from "../../index.js";

export type RunIntegrationWorkerRequest = {
  integrationPath: string;
  exportName: string;
  session: string;
  params: unknown;
  headless: boolean;
};

export type RunIntegrationWorkerMessage =
  | { type: "completed" }
  | { type: "paused"; details: RunDebugPauseDetails }
  | { type: "failed"; message: string };
