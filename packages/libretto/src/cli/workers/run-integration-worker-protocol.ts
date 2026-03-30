import { z } from "zod";

export const RunIntegrationWorkerRequestSchema = z.object({
  integrationPath: z.string().min(1),
  workflowName: z.string().min(1),
  session: z.string().min(1),
  params: z.unknown(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  headless: z.boolean(),
  visualize: z.boolean().default(true),
  authProfileDomain: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
});

export type RunIntegrationWorkerRequest = z.infer<
  typeof RunIntegrationWorkerRequestSchema
>;
