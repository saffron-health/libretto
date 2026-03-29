import { execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { SimpleCLI } from "../framework/simple-cli.js";

type DeploymentStatus = "building" | "ready" | "failed";

type DeploymentResponse = {
  json: {
    deployment_id: string;
    name: string;
    version: number;
    status: DeploymentStatus;
    workflows?: string[] | null;
    build_error?: string | null;
  };
};

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

function buildSourceTarball(sourceDir: string): string {
  const absSourceDir = resolve(sourceDir);

  const pkgJsonPath = join(absSourceDir, "package.json");
  try {
    readFileSync(pkgJsonPath, "utf8");
  } catch {
    throw new Error(
      `No package.json found in ${absSourceDir}. Deploy source must contain a package.json.`,
    );
  }

  const dir = join(tmpdir(), `libretto-deploy-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  cpSync(absSourceDir, dir, { recursive: true });

  const tarPath = join(dir, "source.tar.gz");
  execSync(
    `tar czf "${tarPath}" --exclude=source.tar.gz --exclude=node_modules --exclude=.git -C "${dir}" .`,
  );
  return readFileSync(tarPath).toString("base64");
}

async function pollDeployment(
  apiUrl: string,
  apiKey: string,
  deploymentId: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<DeploymentResponse["json"]> {
  const start = Date.now();
  let status: DeploymentStatus = "building";
  let deployment: DeploymentResponse["json"] | undefined;

  while (status === "building" && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const res = await postJson(apiUrl, apiKey, "/v1/deployments/get", {
      id: deploymentId,
    });
    const body = (await res.json()) as DeploymentResponse;
    if (res.status !== 200) {
      throw new Error(
        `Failed to get deployment status (${res.status}): ${JSON.stringify(body)}`,
      );
    }
    status = body.json.status;
    deployment = body.json;
    process.stdout.write(".");
  }
  console.log();

  if (!deployment) {
    throw new Error("Deployment timed out before receiving a status update.");
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
    name: SimpleCLI.option(z.string(), {
      help: "Deployment name",
    }),
    description: SimpleCLI.option(z.string().optional(), {
      help: "Deployment description",
    }),
    entryPoint: SimpleCLI.option(z.string().optional(), {
      name: "entry-point",
      help: "Entry point file (default: index.ts)",
    }),
  },
});

export const deployCommand = SimpleCLI.command({
  description: "[experimental] Deploy workflows to the hosted platform",
  experimental: true,
})
  .input(deployInput)
  .handle(async ({ input }) => {
    const { apiUrl, apiKey } = getConfig();

    console.log(`Packaging source from ${resolve(input.sourceDir)}...`);
    const source = buildSourceTarball(input.sourceDir);

    const createPayload: Record<string, unknown> = {
      name: input.name,
      source,
    };
    if (input.description) createPayload.description = input.description;
    if (input.entryPoint) createPayload.entry_point = input.entryPoint;

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

    const { deployment_id, name, version, status } = body.json;
    console.log(
      `Deployment created: ${name} v${version} (${deployment_id})`,
    );
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
