import { registerJobs } from "./registry.js";
import type { AnyJobDef, JobsMap } from "./types.js";

export function defineJob<const TJob extends AnyJobDef>(job: TJob): TJob {
  return job;
}

export function defineJobs<const TJobs extends JobsMap>(jobs: TJobs): TJobs {
  return registerJobs(jobs);
}
