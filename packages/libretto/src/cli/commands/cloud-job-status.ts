import { SimpleCLI } from "affordance";
import { z } from "zod";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey, type CloudApiKeyContext } from "./shared.js";

type JobResponse = {
  job_id: string;
  hosted_workflow_id?: string;
  status: string;
  result?: unknown;
  error?: string;
  live_view_url?: string | null;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

async function getJob(ctx: CloudApiKeyContext, id: string): Promise<JobResponse> {
  return orpcCall<JobResponse>({
    apiUrl: ctx.apiUrl,
    path: "/v1/jobs/get",
    input: { id },
    credential: ctx.credential,
  });
}

export function createCloudJobStatusCommand(options: {
  kind: "deployed" | "catalogue";
  namespace: "jobs" | "catalogue";
}) {
  const catalogue = options.kind === "catalogue";
  return SimpleCLI.command({
    description: `Get or watch a ${options.kind} workflow job`,
  })
    .input(
      SimpleCLI.input({
        positionals: [
          SimpleCLI.positional("jobId", z.string().uuid().optional(), {
            help: `${catalogue ? "Catalogue" : "Deployed"} workflow job id`,
          }),
        ],
        named: {
          watch: SimpleCLI.flag({
            help: "Poll until the job reaches a terminal status",
          }),
          intervalSeconds: SimpleCLI.option(
            z.coerce.number().min(0.1).max(60).optional(),
            {
              name: "interval-seconds",
              help: "Watch polling interval (default: 2)",
            },
          ),
          json: SimpleCLI.flag({ help: "Print machine-readable JSON" }),
        },
      }).refine(
        (input) => Boolean(input.jobId),
        `Usage: libretto cloud ${options.namespace} status <job-id> [--watch]`,
      ),
    )
    .use(withCloudApiKey(`read ${options.kind} workflow jobs`))
    .handle(async ({ input, ctx }) => {
      let job = await getJob(ctx, input.jobId!);
      if (Boolean(job.hosted_workflow_id) !== catalogue) {
        const correctNamespace = catalogue ? "jobs" : "catalogue";
        throw new Error(
          `Job ${input.jobId} is a ${catalogue ? "deployed" : "catalogue"} workflow run. Use \`libretto cloud ${correctNamespace} status ${input.jobId}\`.`,
        );
      }
      let lastStatus: string | undefined;
      while (input.watch && !terminalStatuses.has(job.status)) {
        if (!input.json && job.status !== lastStatus) {
          console.log(`Status: ${job.status}`);
          lastStatus = job.status;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, (input.intervalSeconds ?? 2) * 1000),
        );
        job = await getJob(ctx, input.jobId!);
      }
      if (input.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Job: ${job.job_id}`);
        console.log(`Status: ${job.status}`);
        if (job.live_view_url) console.log(`Live view: ${job.live_view_url}`);
        if (job.result !== undefined) {
          console.log(`Result: ${JSON.stringify(job.result)}`);
        }
        if (job.error) console.log(`Error: ${job.error}`);
      }
      return job;
    });
}
