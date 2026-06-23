import { randomBytes } from "node:crypto";
import { z } from "zod";
import { orpcCall } from "../core/auth-fetch.js";
import {
  buildHostedDeployTarball,
  type WorkflowDeployMetadata,
} from "../core/deploy-artifact.js";
import { readAuthState } from "../core/auth-storage.js";
import { SimpleCLI } from "affordance";
import { withCloudApiKey } from "./shared.js";

type DeploymentStatus = "building" | "ready" | "failed";

type DeploymentResponse = {
  json: {
    deployment_id: string;
    status: DeploymentStatus;
    workflows?: string[] | null;
    build_error?: string | null;
  };
};

type EnsureProfileResponse = {
  success: true;
  profile_id: string;
  name: string;
  created: boolean;
};

function generateDeploymentName(): string {
  return `deploy-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function deployApiKeyRequiredMessage(hasStoredSession: boolean): string {
  if (hasStoredSession) {
    return [
      "LIBRETTO_API_KEY is required to deploy to Libretto Cloud.",
      "You are logged in locally, but deploy endpoints require API-key auth.",
      "  • Generate a key: run `libretto cloud auth api-key issue --label <label>`.",
      "  • Add it to your project .env file: `LIBRETTO_API_KEY=<issued-key>`.",
    ].join("\n");
  }

  return [
    "LIBRETTO_API_KEY is required to deploy to Libretto Cloud.",
    "No local cloud session was found.",
    "  • New account: run `libretto cloud auth signup`, then verify your email.",
    "  • Existing account: run `libretto cloud auth login`.",
    "  • Generate a key: run `libretto cloud auth api-key issue --label <label>`.",
    "  • Add it to your project .env file: `LIBRETTO_API_KEY=<issued-key>`.",
  ].join("\n");
}

async function hasStoredCloudSession(): Promise<boolean> {
  try {
    return Boolean((await readAuthState())?.session);
  } catch {
    return false;
  }
}

async function pollDeployment(
  apiUrl: string,
  credential: { source: "env-api-key"; apiKey: string },
  deploymentId: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<DeploymentResponse["json"]> {
  const start = Date.now();
  const workflowWaitMs = 60_000;
  let status: DeploymentStatus = "building";
  let workflows: string[] | null | undefined = null;
  let readyAt: number | null = null;
  let deployment: DeploymentResponse["json"] | undefined;

  while (Date.now() - start < maxWaitMs) {
    if (status !== "building" && status !== "ready") break;
    if (status === "ready" && workflows?.length) break;
    if (status === "ready" && readyAt && Date.now() - readyAt > workflowWaitMs) break;

    await new Promise((r) => setTimeout(r, pollIntervalMs));

    deployment = await orpcCall<DeploymentResponse["json"]>({
      apiUrl,
      path: "/v1/deployments/sync",
      input: { id: deploymentId },
      credential,
    });
    status = deployment.status;
    workflows = deployment.workflows;
    if (status === "ready" && readyAt === null) readyAt = Date.now();
    process.stdout.write(".");
  }
  console.log();

  if (!deployment) {
    throw new Error("Deployment timed out before receiving a status update.");
  }

  if (status === "ready" && !workflows?.length) {
    throw new Error(
      "Build completed but workflow discovery failed due to a server-side error. Please redeploy.",
    );
  }

  return deployment;
}

async function ensureWorkflowAuthProfiles(args: {
  apiUrl: string;
  credential: { source: "env-api-key"; apiKey: string };
  workflows: readonly WorkflowDeployMetadata[];
}): Promise<void> {
  const profileNames = [
    ...new Set(
      args.workflows
        .map((workflow) => workflow.authProfileName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (profileNames.length === 0) return;

  console.log(
    `Ensuring cloud auth ${profileNames.length === 1 ? "profile" : "profiles"}: ${profileNames.join(", ")}`,
  );
  for (const name of profileNames) {
    await orpcCall<EnsureProfileResponse>({
      apiUrl: args.apiUrl,
      path: "/v1/browserProfiles/ensure",
      input: { name },
      credential: args.credential,
    });
  }
}

export const deployInput = SimpleCLI.input({
  positionals: [
    SimpleCLI.positional("sourceDir", z.string().default("."), {
      help: "Path to source directory (default: current directory)",
    }),
  ],
  named: {
    description: SimpleCLI.option(z.string().optional(), {
      help: "Deployment description",
    }),
    entryPoint: SimpleCLI.option(z.string().optional(), {
      name: "entry-point",
      help: "Entry point file (default: index.ts)",
    }),
    autoRepair: SimpleCLI.flag({
      name: "auto-repair",
      help: "Route failed jobs for this deployment to autofix",
    }),
    external: SimpleCLI.option(
      z
        .string()
        .optional()
        .transform((value) =>
          value
            ?.split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0) ?? [],
        ),
      {
        help:
          "Comma-separated packages to keep out of the bundle and install into the deployed package",
      },
    ),
  },
});

export const deployCommand = SimpleCLI.command({
  description: "Deploy workflows to the hosted platform",
})
  .input(deployInput)
  .use(withCloudApiKey(
    "deploy to Libretto Cloud",
    async () => deployApiKeyRequiredMessage(await hasStoredCloudSession()),
  ))
  .handle(async ({ input, ctx }) => {
    const { apiUrl, credential } = ctx;
    const deploymentName = generateDeploymentName();

    // Hosted deploy uploads a generated artifact with a deploy entrypoint and
    // a minimal manifest. Bundled code is embedded in the generated files;
    // external packages are listed in the manifest for installation.
    console.log("Bundling hosted deployment artifact...");
    const { entryPoint, source, workflows } = await buildHostedDeployTarball({
      additionalExternals: input.external,
      deploymentName,
      entryPoint: input.entryPoint,
      sourceDir: input.sourceDir,
    });

    await ensureWorkflowAuthProfiles({ apiUrl, credential, workflows });

    const createPayload: Record<string, unknown> = {
      source,
      entry_point: entryPoint,
    };
    if (input.description) createPayload.description = input.description;
    if (input.autoRepair) createPayload.auto_repair = true;

    console.log("Uploading deployment...");
    const body = await orpcCall<DeploymentResponse["json"]>({
      apiUrl,
      path: "/v1/deployments/create",
      input: createPayload,
      credential,
    });

    const { deployment_id, status } = body;
    console.log(`Deployment created: ${deployment_id}`);
    console.log(`Status: ${status}`);

    if (status === "building") {
      process.stdout.write("Waiting for build");
      const deployment = await pollDeployment(
        apiUrl,
        credential,
        deployment_id,
        10_000,
        5 * 60 * 1000,
      );

      if (deployment.status === "failed") {
        throw new Error(
          `Build failed: ${deployment.build_error ?? "unknown error"}`,
        );
      }

      if (deployment.status === "ready") {
        console.log(`Build complete.`);
        if (deployment.workflows?.length) {
          console.log(
            `Workflows: ${deployment.workflows.join(", ")}`,
          );
        }
      } else {
        console.log(
          `Build still in progress (timed out waiting). Check status with deployment ID: ${deployment_id}`,
        );
      }
    }

    return deployment_id;
  });
