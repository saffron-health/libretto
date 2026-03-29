import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createHostedDeployPackage } from "../src/cli/core/deploy-artifact.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractBundledImplementation(indexSource: string): string {
  const match = indexSource.match(/const BUNDLE_GZIP_BASE64 = "([^"]+)";/);
  if (!match?.[1]) {
    throw new Error("Could not find embedded deployment bundle.");
  }

  return gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
}

describe("createHostedDeployPackage", () => {
  it("bundles workspace package source and strips workspace dependencies from the deploy manifest", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "libretto-deploy-test-"));
    const sourceDir = join(workspaceRoot, "apps", "browser-agent");
    const configDir = join(workspaceRoot, "packages", "config");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

    try {
      mkdirSync(join(sourceDir, "src"), { recursive: true });
      mkdirSync(join(configDir, "src"), { recursive: true });

      writeFileSync(
        join(workspaceRoot, "pnpm-workspace.yaml"),
        ['packages:', '  - "apps/*"', '  - "packages/*"', ""].join("\n"),
      );
      writeJson(join(workspaceRoot, "package.json"), {
        name: "workspace-root",
        private: true,
        devDependencies: {
          libretto: "0.5.3-experimental.99",
        },
      });

      writeJson(join(sourceDir, "package.json"), {
        name: "@repo/browser-agent",
        private: true,
        type: "module",
        dependencies: {
          "@repo/config": "workspace:*",
        },
      });

      writeJson(join(configDir, "package.json"), {
        name: "@repo/config",
        private: true,
        type: "module",
        exports: {
          "./message": {
            types: "./src/message.ts",
            default: "./dist/message.mjs",
          },
        },
      });

      writeFileSync(
        join(configDir, "src", "message.ts"),
        'export const workspaceMessage = "bundled from workspace source";\n',
      );
      writeFileSync(
        entryPoint,
        [
          'import { workflow } from "libretto";',
          'import { workspaceMessage } from "@repo/config/message";',
          "",
          "export const testWorkflow = workflow(",
          '  "testWorkflow",',
          "  async () => workspaceMessage,",
          ");",
          "",
        ].join("\n"),
      );

      const deployPackage = await createHostedDeployPackage({
        deploymentName: "ecw-pull-open-referrals",
        entryPoint,
        sourceDir,
      });

      try {
        const deployManifest = JSON.parse(
          readFileSync(join(deployPackage.outputDir, "package.json"), "utf8"),
        ) as {
          dependencies?: Record<string, string>;
        };
        const bundle = readFileSync(
          join(deployPackage.outputDir, "index.js"),
          "utf8",
        );
        const implementation = extractBundledImplementation(bundle);

        expect(deployManifest.dependencies).toEqual({
          libretto: "0.5.3-experimental.99",
        });
        expect(bundle).toContain("createWorkflowProxy");
        expect(bundle).toContain('export const testWorkflow = createWorkflowProxy("testWorkflow");');
        expect(implementation).toContain("bundled from workspace source");
        expect(implementation).not.toContain("@repo/config/message");
        expect(bundle).not.toContain("workspace:*");
        expect(
          readdirSync(deployPackage.outputDir).filter((file) => file.endsWith(".js")),
        ).toEqual(["index.js"]);
      } finally {
        deployPackage.cleanup();
      }
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("adds user-specified externals to the generated runtime manifest", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "libretto-deploy-test-"));
    const sourceDir = join(workspaceRoot, "apps", "worker");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

    try {
      mkdirSync(join(sourceDir, "src"), { recursive: true });

      writeJson(join(sourceDir, "package.json"), {
        name: "@repo/worker",
        private: true,
        type: "module",
        dependencies: {
          lodash: "^4.17.21",
        },
      });

      writeFileSync(
        entryPoint,
        [
          'import { workflow } from "libretto";',
          'import { chunk } from "lodash";',
          "",
          "export const testWorkflow = workflow(",
          '  "testWorkflow",',
          "  async () => chunk([1, 2, 3], 2),",
          ");",
          "",
        ].join("\n"),
      );

      const deployPackage = await createHostedDeployPackage({
        additionalExternals: ["lodash"],
        deploymentName: "chunk-worker",
        entryPoint,
        sourceDir,
      });

      try {
        const deployManifest = JSON.parse(
          readFileSync(join(deployPackage.outputDir, "package.json"), "utf8"),
        ) as {
          dependencies?: Record<string, string>;
        };
        const bundle = readFileSync(
          join(deployPackage.outputDir, "index.js"),
          "utf8",
        );
        const implementation = extractBundledImplementation(bundle);

        expect(deployManifest.dependencies).toEqual({
          libretto: "0.5.3-experimental.4",
          lodash: "^4.17.21",
        });
        expect(bundle).toContain('export const testWorkflow = createWorkflowProxy("testWorkflow");');
        expect(implementation).toContain("lodash");
      } finally {
        deployPackage.cleanup();
      }
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
