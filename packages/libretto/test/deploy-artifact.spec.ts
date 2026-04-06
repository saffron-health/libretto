import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const require = createRequire(import.meta.url);
const currentLibrettoPackageDir = fileURLToPath(new URL("..", import.meta.url));
const currentLibrettoVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

describe("createHostedDeployPackage", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    cleanups.length = 0;
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  function registerCleanup(cleanup: () => void): void {
    cleanups.unshift(cleanup);
  }

  function createWorkspaceRoot(): string {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "libretto-deploy-test-"));
    registerCleanup(() => {
      rmSync(workspaceRoot, { force: true, recursive: true });
    });
    return workspaceRoot;
  }

  function trackDeployPackage(
    deployPackage: Awaited<ReturnType<typeof createHostedDeployPackage>>,
  ): Awaited<ReturnType<typeof createHostedDeployPackage>> {
    registerCleanup(() => {
      deployPackage.cleanup();
    });
    return deployPackage;
  }

  function listDeployTempRoots(): string[] {
    return readdirSync(tmpdir())
      .filter((entry) => entry.startsWith("libretto-deploy-"))
      .sort();
  }

  async function rebundleDeployEntrypointToCjs(args: {
    deployPackage: Awaited<ReturnType<typeof createHostedDeployPackage>>;
    outfile: string;
  }): Promise<
    Record<
      string,
      {
        name?: string;
        run?: (ctx: unknown, input: unknown) => Promise<unknown>;
      }
    >
  > {
    const nodeModulesDir = join(dirname(args.outfile), "node_modules");
    mkdirSync(nodeModulesDir, { recursive: true });
    const linkedPackageDirs = [
      join(nodeModulesDir, "libretto"),
      join(tmpdir(), "node_modules", "libretto"),
    ];
    for (const linkedPackageDir of linkedPackageDirs) {
      if (existsSync(linkedPackageDir)) {
        continue;
      }
      mkdirSync(dirname(linkedPackageDir), { recursive: true });
      symlinkSync(currentLibrettoPackageDir, linkedPackageDir, "dir");
    }

    await build({
      bundle: true,
      entryPoints: [join(args.deployPackage.outputDir, "index.js")],
      external: ["libretto"],
      format: "cjs",
      outfile: args.outfile,
      platform: "node",
      target: "node20",
    });

    return require(args.outfile) as Record<
      string,
      {
        name?: string;
        run?: (ctx: unknown, input: unknown) => Promise<unknown>;
      }
    >;
  }

  it("bundles workspace package source and strips workspace dependencies from the deploy manifest", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "browser-agent");
    const configDir = join(workspaceRoot, "packages", "config");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

    mkdirSync(join(sourceDir, "src"), { recursive: true });
    mkdirSync(join(configDir, "src"), { recursive: true });

    writeFileSync(
      join(workspaceRoot, "pnpm-workspace.yaml"),
      ["packages:", '  - "apps/*"', '  - "packages/*"', ""].join("\n"),
    );
    writeJson(join(workspaceRoot, "package.json"), {
      name: "workspace-root",
      private: true,
      devDependencies: {
        libretto: "0.5.4",
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

    const deployPackage = trackDeployPackage(
      await createHostedDeployPackage({
        deploymentName: "ecw-pull-open-referrals",
        entryPoint,
        sourceDir,
      }),
    );

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
      libretto: "0.5.4",
    });
    expect(bundle).toContain('createWorkflowProxy("testWorkflow")');
    expect(implementation).toContain("bundled from workspace source");
    expect(implementation).not.toContain("@repo/config/message");
    expect(bundle).not.toContain("workspace:*");
    expect(
      readdirSync(deployPackage.outputDir).filter((file) =>
        file.endsWith(".js"),
      ),
    ).toEqual(["index.js"]);
  });

  it("rejects workflows that are only imported for side effects by the deploy entry point", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "browser-agent");
    const entryPoint = join(sourceDir, "src", "index.ts");

    mkdirSync(join(sourceDir, "src", "workflows"), { recursive: true });

    writeJson(join(sourceDir, "package.json"), {
      name: "@repo/browser-agent",
      private: true,
      type: "module",
      dependencies: {
        libretto: currentLibrettoVersion.version,
      },
    });

    writeFileSync(
      join(sourceDir, "src", "workflows", "test.ts"),
      [
        'import { workflow } from "libretto";',
        "",
        "export default workflow(",
        '  "test",',
        '  async () => "IMPORTED_ONLY_WORKFLOW",',
        ");",
        "",
      ].join("\n"),
    );
    writeFileSync(
      entryPoint,
      ['import "./workflows/test";', ""].join("\n"),
    );

    await expect(
      createHostedDeployPackage({
        deploymentName: "import-only-entrypoint",
        entryPoint,
        sourceDir,
      }),
    ).rejects.toThrow(
      'Non-exported workflows: test',
    );
  });

  it("adds user-specified externals to the generated runtime manifest", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "worker");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

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

    const deployPackage = trackDeployPackage(
      await createHostedDeployPackage({
        additionalExternals: ["lodash"],
        deploymentName: "chunk-worker",
        entryPoint,
        sourceDir,
      }),
    );

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
      libretto: currentLibrettoVersion.version,
      lodash: "^4.17.21",
    });
    expect(bundle).toContain('createWorkflowProxy("testWorkflow")');
    expect(implementation).toContain("lodash");
  });

  it("vendors the current libretto package when the source manifest uses a local-only libretto spec", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "worker");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

    mkdirSync(join(sourceDir, "src"), { recursive: true });

    writeJson(join(sourceDir, "package.json"), {
      name: "@repo/worker",
      private: true,
      type: "module",
      dependencies: {
        libretto:
          "github:saffron-health/libretto#feat/deploy-cli&path:/packages/libretto",
      },
    });

    writeFileSync(
      entryPoint,
      [
        'import { workflow } from "libretto";',
        "",
        "export const testWorkflow = workflow(",
        '  "testWorkflow",',
        "  async () => ({ ok: true }),",
        ");",
        "",
      ].join("\n"),
    );

    const deployPackage = trackDeployPackage(
      await createHostedDeployPackage({
        deploymentName: "vendored-libretto-worker",
        entryPoint,
        sourceDir,
      }),
    );

    const deployManifest = JSON.parse(
      readFileSync(join(deployPackage.outputDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(deployManifest.dependencies).toEqual({
      libretto: "file:./libretto",
    });
    expect(
      existsSync(join(deployPackage.outputDir, "libretto", "package.json")),
    ).toBe(true);
    expect(
      existsSync(join(deployPackage.outputDir, "libretto", "dist", "index.js")),
    ).toBe(true);
  });

  it("keeps re-exported default workflows runnable after rebundling the generated entrypoint to cjs", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "worker");
    const entryPoint = join(sourceDir, "src", "index.ts");
    const bundledEntryPoint = join(workspaceRoot, "bundled-entry.cjs");

    mkdirSync(join(sourceDir, "src", "workflows"), { recursive: true });

    writeJson(join(sourceDir, "package.json"), {
      name: "@repo/worker",
      private: true,
      type: "module",
      dependencies: {
        libretto:
          "github:saffron-health/libretto#feat/deploy-cli&path:/packages/libretto",
      },
    });

    writeFileSync(
      join(sourceDir, "src", "workflows", "workflow.ts"),
      [
        'import { workflow } from "libretto";',
        "",
        "export default workflow(",
        '  "testWorkflow",',
        "  async () => ({ ok: true }),",
        ");",
        "",
      ].join("\n"),
    );
    writeFileSync(
      entryPoint,
      ['export { default as myExport } from "./workflows/workflow";', ""].join(
        "\n",
      ),
    );

    const deployPackage = trackDeployPackage(
      await createHostedDeployPackage({
        deploymentName: "cjs-runtime-worker",
        entryPoint,
        sourceDir,
      }),
    );

    const bundledModule = await rebundleDeployEntrypointToCjs({
      deployPackage,
      outfile: bundledEntryPoint,
    });
    const deployedWorkflow = Object.values(bundledModule).find(
      (candidate) =>
        candidate?.name === "testWorkflow" && typeof candidate.run === "function",
    );

    expect(deployedWorkflow).toBeDefined();

    await expect(
      deployedWorkflow!.run!(
        {
          session: "test-session",
          page: {} as never,
          logger: {
            info() {},
            warn() {},
            error() {},
          },
        },
        {},
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("does not resolve bare workspace imports through subpath-only exports", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "browser-agent");
    const configDir = join(workspaceRoot, "packages", "config");
    const entryPoint = join(sourceDir, "src", "workflow.ts");

    mkdirSync(join(sourceDir, "src"), { recursive: true });
    mkdirSync(join(configDir, "src"), { recursive: true });

    writeFileSync(
      join(workspaceRoot, "pnpm-workspace.yaml"),
      ["packages:", '  - "apps/*"', '  - "packages/*"', ""].join("\n"),
    );
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
        'import { workspaceMessage } from "@repo/config";',
        "",
        "export const testWorkflow = workflow(",
        '  "testWorkflow",',
        "  async () => workspaceMessage,",
        ");",
        "",
      ].join("\n"),
    );

    await expect(
      createHostedDeployPackage({
        deploymentName: "invalid-root-workspace-import",
        entryPoint,
        sourceDir,
      }),
    ).rejects.toThrow('Unable to resolve workspace import "@repo/config"');
  });

  it("cleans up the temp deploy workspace when packaging fails after bundling", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceDir = join(workspaceRoot, "apps", "worker");
    const entryPoint = join(sourceDir, "src", "workflow.ts");
    const tempRootsBefore = new Set(listDeployTempRoots());

    mkdirSync(join(sourceDir, "src"), { recursive: true });

    writeJson(join(sourceDir, "package.json"), {
      name: "@repo/worker",
      private: true,
      type: "module",
    });
    writeFileSync(
      entryPoint,
      [
        'import { workflow } from "libretto";',
        "",
        "export const testWorkflow = workflow(",
        '  "testWorkflow",',
        "  async () => ({ ok: true }),",
        ");",
        "",
      ].join("\n"),
    );

    await expect(
      createHostedDeployPackage({
        additionalExternals: ["leftpad"],
        deploymentName: "missing-external-version",
        entryPoint,
        sourceDir,
      }),
    ).rejects.toThrow(
      'Unable to determine a version for external package "leftpad".',
    );

    const leakedTempRoots = listDeployTempRoots().filter(
      (entry) => !tempRootsBefore.has(entry),
    );
    expect(leakedTempRoots).toEqual([]);
  });
});
