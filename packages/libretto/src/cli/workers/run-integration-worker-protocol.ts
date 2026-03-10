import { z } from "zod";
import type { RunDebugPauseDetails } from "../../index.js";

export const RunIntegrationWorkerRequestSchema = z.object({
  integrationPath: z.string().min(1),
  exportName: z.string().min(1),
  session: z.string().min(1),
  params: z.unknown(),
  headless: z.boolean(),
});

export type RunIntegrationWorkerRequest = z.infer<
  typeof RunIntegrationWorkerRequestSchema
>;

export type RunIntegrationWorkerMessage =
  | { type: "completed" }
  | { type: "paused"; details: RunDebugPauseDetails }
  | { type: "failed"; message: string };
