import { z } from "zod";
import { SessionAccessModeSchema } from "../../shared/state/index.js";

export const RunIntegrationWorkerRequestSchema = z.object({
  integrationPath: z.string().min(1),
  workflowName: z.string().min(1),
  session: z.string().min(1),
  params: z.unknown(),
  headless: z.boolean(),
  visualize: z.boolean().default(true),
  authProfileDomain: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  accessMode: SessionAccessModeSchema.default("write-access"),
});

export type RunIntegrationWorkerRequest = z.infer<
  typeof RunIntegrationWorkerRequestSchema
>;
