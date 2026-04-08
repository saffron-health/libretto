import { randomBytes } from "node:crypto";
import { z } from "zod";
import { buildHostedDeployTarball } from "../core/deploy-artifact.js";
import { SimpleCLI } from "../framework/simple-cli.js";

type DeploymentStatus = "building" | "ready" | "failed";

type DeploymentResponse = {
  json: {
    deployment_id: string;
    status: DeploymentStatus;
    workflows?: string[] | null;
    build_error?: string | null;
  };
};

function generateDeploymentName(): string {
  return `deploy-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function getConfig() {
  const apiUrl = process.env.LIBRETTO_API_URL;
  const apiKey = process.env.LIBRETTO_API_KEY;

  if (!apiUrl) {
    throw new Error(
      "LIBRETTO_API_URL environment variable is required.",
    );
  }
  if (!apiKey) {
    throw new Error(
      "LIBRETTO_API_KEY environment variable is required.",
    );
  }

  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

async function postJson(
  apiUrl: string,
  apiKey: string,
  path: string,
  input: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ json: input }),
  });
}

async function pollDeployment(
  apiUrl: string,
  apiKey: string,
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

    const res = await postJson(apiUrl, apiKey, "/v1/deployments/sync", {
      id: deploymentId,
    });
    const body = (await res.json()) as DeploymentResponse;
    if (res.status !== 200) {
      throw new Error(
        `Failed to sync deployment status (${res.status}): ${JSON.stringify(body)}`,
      );
    }
    status = body.json.status;
    workflows = body.json.workflows;
    deployment = body.json;
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
  experimental: true,
})
  .input(deployInput)
  .handle(async ({ input }) => {
    const { apiUrl, apiKey } = getConfig();
    const deploymentName = generateDeploymentName();

    // Hosted deploy uploads a generated artifact with a deploy entrypoint and
    // a minimal manifest. Bundled code is embedded in the generated files;
    // external packages are listed in the manifest for installation.
    console.log("Bundling hosted deployment artifact...");
    const { entryPoint, source } = await buildHostedDeployTarball({
      additionalExternals: input.external,
      deploymentName,
      entryPoint: input.entryPoint,
      sourceDir: input.sourceDir,
    });

    const createPayload: Record<string, unknown> = {
      source,
      entry_point: entryPoint,
    };
    if (input.description) createPayload.description = input.description;

    console.log("Uploading deployment...");
    const res = await postJson(
      apiUrl,
      apiKey,
      "/v1/deployments/create",
      createPayload,
    );
    const body = (await res.json()) as DeploymentResponse;
    if (res.status !== 200) {
      throw new Error(
        `Failed to create deployment (${res.status}): ${JSON.stringify(body)}`,
      );
    }

    const { deployment_id, status } = body.json;
    console.log(`Deployment created: ${deployment_id}`);
    console.log(`Status: ${status}`);

    if (status === "building") {
      process.stdout.write("Waiting for build");
      const deployment = await pollDeployment(
        apiUrl,
        apiKey,
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
