import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey, type CloudApiKeyContext } from "./shared.js";

type PrivacyFinding = {
  severity: "warning" | "blocked";
  file: string;
  line: number | null;
  explanation: string;
  suggestedFix: string;
};

type PublishResponse =
  | {
      status: "created" | "existing" | "refreshed";
      workflow: string;
      hosted_workflow: string;
      page_url: string;
      deployment_version: number;
    }
  | {
      status: "needs_review" | "blocked";
      workflow: string;
      review_id: string;
      findings: PrivacyFinding[];
    }
  | { status: "review_expired"; workflow: string };

function printFindings(findings: PrivacyFinding[]): void {
  for (const finding of findings) {
    const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
    console.error(
      `${finding.severity.toUpperCase()} ${location}: ${finding.explanation}`,
    );
    console.error(`Fix: ${finding.suggestedFix}`);
  }
}

export async function publishWorkflowWithPrivacyReview(
  ctx: CloudApiKeyContext,
  input: { workflow: string; description?: string; acknowledgeWarnings: boolean },
): Promise<PublishResponse> {
  const first = await orpcCall<PublishResponse>({
    apiUrl: ctx.apiUrl,
    path: "/v1/workflows/publish",
    input: {
      workflow: input.workflow,
      description: input.description,
      privacyReview: { capability: "workflow_privacy_review_v1" },
    },
    credential: ctx.credential,
  });
  if (first.status === "blocked") {
    printFindings(first.findings);
    throw new Error("Publishing is blocked. Fix the findings and deploy again.");
  }
  if (first.status !== "needs_review") return first;
  printFindings(first.findings);
  if (!input.acknowledgeWarnings) {
    throw new Error(
      "Review the warnings, then run the command again with --acknowledge-warnings to publish this exact deployment.",
    );
  }
  return orpcCall<PublishResponse>({
    apiUrl: ctx.apiUrl,
    path: "/v1/workflows/publish",
    input: {
      workflow: input.workflow,
      description: input.description,
      privacyReview: {
        capability: "workflow_privacy_review_v1",
        reviewId: first.review_id,
        acknowledgeWarnings: true,
      },
    },
    credential: ctx.credential,
  });
}

export const publishWorkflowCommand = SimpleCLI.command({
  description: "Publish a deployed workflow outside your workspace",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("workflow", z.string().min(1), {
          help: "Deployed workflow name to publish",
        }),
      ],
      named: {
        description: SimpleCLI.option(z.string().optional(), {
          help: "Public workflow description",
        }),
        acknowledgeWarnings: SimpleCLI.flag({
          help: "Publish after acknowledging privacy review warnings",
        }),
      },
    }),
  )
  .use(withCloudApiKey("publish a Libretto Cloud workflow"))
  .handle(async ({ input, ctx }) => {
    const response = await publishWorkflowWithPrivacyReview(ctx, input);
    if (!("page_url" in response)) {
      throw new Error(
        response.status === "review_expired"
          ? "The privacy review expired. Run publish again."
          : "The workflow was not published.",
      );
    }
    console.log(`Published workflow: ${response.hosted_workflow}`);
    console.log(`Public page: ${response.page_url}`);
    console.log(`Deployment version: ${response.deployment_version}`);
    console.log("Source code: public");
    return response.page_url;
  });

export const unpublishWorkflowCommand = SimpleCLI.command({
  description: "Remove a workflow's public API and source code",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("workflow", z.string().min(1), {
          help: "Published workflow name to remove",
        }),
      ],
      named: {},
    }),
  )
  .use(withCloudApiKey("unpublish a Libretto Cloud workflow"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<{ hosted_workflow: string }>({
      apiUrl: ctx.apiUrl,
      path: "/v1/workflows/unpublish",
      input: { workflow: input.workflow },
      credential: ctx.credential,
    });
    console.log(`Unpublished workflow: ${response.hosted_workflow}`);
    return response.hosted_workflow;
  });
