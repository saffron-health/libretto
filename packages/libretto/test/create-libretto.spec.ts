import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const hasPnpm = spawnSync("pnpm", ["--version"], {
  encoding: "utf8",
}).status === 0;

const runIfPnpm = hasPnpm ? test : test.skip;
const here = fileURLToPath(new URL(".", import.meta.url));
const createLibrettoRoot = resolve(here, "../../create-libretto");
const createLibrettoBin = resolve(createLibrettoRoot, "dist/bin/create-libretto.js");
const librettoPackageRoot = resolve(here, "..");
const librettoPackageJsonPath = resolve(librettoPackageRoot, "package.json");

let didBuildCreateLibretto = false;

function ensureCreateLibrettoBuilt(): void {
  if (didBuildCreateLibretto) return;
  const result = spawnSync("pnpm", ["build"], {
    cwd: createLibrettoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build create-libretto before tests.\n${result.stdout}\n${result.stderr}`,
    );
  }
  didBuildCreateLibretto = true;
}

function execProcess(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<SpawnResult> {
  return new Promise((resolveResult, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({
            exitCode: 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
          return;
        }

        const candidate = (
          error as NodeJS.ErrnoException & { code?: number | string }
        ).code;
        if (error.name === "AbortError") {
          reject(error);
          return;
        }

        resolveResult({
          exitCode: typeof candidate === "number" ? candidate : 1,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

describe("create-libretto bootstrap", () => {
  runIfPnpm(
    "installs libretto and runs owned setup with a local link dependency",
    async () => {
      ensureCreateLibrettoBuilt();
      const workspaceDir = await mkdtemp(
        join(tmpdir(), "libretto-create-bootstrap-"),
      );
      const expectedVersion = JSON.parse(
        await readFile(librettoPackageJsonPath, "utf8"),
      ).version as string;

      await writeFile(
        join(workspaceDir, "package.json"),
        `${JSON.stringify(
          {
            name: "create-libretto-fixture",
            private: true,
            packageManager: "pnpm@9.15.4",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await mkdir(join(workspaceDir, ".agents"), { recursive: true });

      const result = await execProcess(
        process.execPath,
        [createLibrettoBin, "--skip-browsers"],
        workspaceDir,
        {
          LIBRETTO_CREATE_LIBRETTO_SPEC: `link:${librettoPackageRoot}`,
          LIBRETTO_DISABLE_DOTENV: "1",
          OPENAI_API_KEY: "",
          ANTHROPIC_API_KEY: "",
          GEMINI_API_KEY: "",
          GOOGLE_GENERATIVE_AI_API_KEY: "",
          GOOGLE_CLOUD_PROJECT: "",
          GCLOUD_PROJECT: "",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Installing link:${librettoPackageRoot}`);
      expect(result.stdout).toContain(
        `Running Libretto setup with libretto@${expectedVersion}...`,
      );
      expect(result.stdout).toContain("Skipping browser installation");
      expect(result.stdout).toContain(".agents/skills/libretto/");

      const manifest = JSON.parse(
        await readFile(join(workspaceDir, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
      };
      expect(manifest.dependencies?.libretto).toBe(
        `link:${librettoPackageRoot}`,
      );

      const installedSkill = await readFile(
        join(workspaceDir, ".agents", "skills", "libretto", "SKILL.md"),
        "utf8",
      );
      expect(installedSkill).toContain(`version: "${expectedVersion}"`);

      await expect(
        readFile(join(workspaceDir, ".libretto", ".gitignore"), "utf8"),
      ).resolves.toContain("sessions/");
    },
    60_000,
  );
});
