import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const postinstallScript = join(repoRoot, "scripts", "postinstall.mjs");
const sourceSkillDir = join(repoRoot, "skills", "libretto");
const tempDirs: string[] = [];

async function runPostinstall(initCwd: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolveResult, reject) => {
    execFile(
      "node",
      [postinstallScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          INIT_CWD: initCwd,
        },
      },
      (error, stdout, stderr) => {
        if (error && error.name === "AbortError") {
          reject(error);
          return;
        }

        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;

        resolveResult({
          exitCode: code,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("postinstall skill sync", () => {
  test("package.json publishes and runs the postinstall helper", async () => {
    const packageJson = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf8"),
    ) as {
      files: string[];
      scripts: Record<string, string>;
    };

    expect(packageJson.files).toContain("scripts/postinstall.mjs");
    expect(packageJson.scripts.postinstall).toContain("node ./scripts/postinstall.mjs");
  });

  test("syncs the bundled skill into the consuming repo", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "libretto-postinstall-"));
    tempDirs.push(workspace);

    await mkdir(join(workspace, ".agents", "skills"), { recursive: true });

    const result = await runPostinstall(workspace);
    const destinationSkillDir = join(workspace, ".agents", "skills", "libretto");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Synced skill to "${destinationSkillDir}".`);
    expect(existsSync(join(destinationSkillDir, "SKILL.md"))).toBe(true);
    expect(await readFile(join(destinationSkillDir, "SKILL.md"), "utf8")).toBe(
      await readFile(join(sourceSkillDir, "SKILL.md"), "utf8"),
    );
  });
});
