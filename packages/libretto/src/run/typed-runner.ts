import { findJobTypeByDefinition, registerJobs } from "./registry.js";
import { launchJob } from "./launcher.js";
import type { JobDefParams, JobLaunchResult, JobsMap, LaunchConfig } from "./types.js";

export type LocalRunner<TJobs extends JobsMap> = {
  runJob<TKey extends keyof TJobs>(
    job: TJobs[TKey],
    params: JobDefParams<TJobs[TKey]>,
    options?: { session?: string; config?: LaunchConfig },
  ): Promise<JobLaunchResult>;
};

export function createLocalRunner<const TJobs extends JobsMap>(
  jobs: TJobs,
): LocalRunner<TJobs> {
  registerJobs(jobs);

  return {
    runJob: async <TKey extends keyof TJobs>(
      job: TJobs[TKey],
      params: JobDefParams<TJobs[TKey]>,
      options?: { session?: string; config?: LaunchConfig },
    ): Promise<JobLaunchResult> => {
      const jobType = findJobTypeByDefinition(jobs, job);
      return await launchJob({
        jobType: String(jobType),
        params,
        session: options?.session,
        config: options?.config,
      });
    },
  };
}
