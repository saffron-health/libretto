import type { AnyJobDef, JobsMap } from "./types.js";

// Use Symbol.for() to ensure a single shared registry across source and dist
// copies of this module (e.g., when entrypoint.ts runs from source but the
// registry module imports from the built package export).
const REGISTRY_KEY = Symbol.for("libretto.jobRegistry");
const globalRegistry: Map<string, AnyJobDef> =
  ((globalThis as any)[REGISTRY_KEY] ??= new Map());

export function registerJobs<TJobs extends JobsMap>(jobs: TJobs): TJobs {
  for (const [jobType, definition] of Object.entries(jobs)) {
    const existing = globalRegistry.get(jobType);
    if (existing && existing !== definition) {
      throw new Error(`Duplicate job key "${jobType}" detected.`);
    }
    globalRegistry.set(jobType, definition);
  }
  return jobs;
}

export function getRegisteredJobs(): ReadonlyMap<string, AnyJobDef> {
  return globalRegistry;
}

export function listRegisteredJobTypes(): string[] {
  return [...globalRegistry.keys()].sort();
}

export function resolveRegisteredJob(jobType: string): AnyJobDef {
  const job = globalRegistry.get(jobType);
  if (job) return job;

  const registered = listRegisteredJobTypes();
  const detail = registered.length > 0
    ? `Registered jobs: ${registered.join(", ")}`
    : "No jobs are registered. Import your integration jobs module before invoking the runner.";
  throw new Error(`Unknown job type "${jobType}". ${detail}`);
}

export function findJobTypeByDefinition<TJobs extends JobsMap>(
  jobs: TJobs,
  target: TJobs[keyof TJobs],
): keyof TJobs {
  for (const [jobType, definition] of Object.entries(jobs) as Array<[keyof TJobs, TJobs[keyof TJobs]]>) {
    if (definition === target) return jobType;
  }
  throw new Error("Job definition is not part of the provided registry.");
}
