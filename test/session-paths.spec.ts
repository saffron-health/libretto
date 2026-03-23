import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { ensureLibrettoSessionStatePath } from "../src/shared/paths/paths.js";

describe("session path resolution", () => {
  test("anchors session state at the git repo root when invoked from a nested package", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "libretto-monorepo-"));
    const nestedPackageDir = join(repoRoot, "apps", "browser-agent");
    mkdirSync(nestedPackageDir, { recursive: true });
    await writeFile(
      join(repoRoot, "package.json"),
      '{"name":"repo-root"}\n',
      "utf8",
    );

    execFileSync("git", ["init"], {
      cwd: repoRoot,
      stdio: "ignore",
    });

    const statePath = ensureLibrettoSessionStatePath(
      "browser-agent",
      nestedPackageDir,
    );
    const resolvedStatePath = join(
      await realpath(dirname(statePath)),
      "state.json",
    );
    const resolvedRepoRoot = await realpath(repoRoot);
    const resolvedNestedPackageDir = await realpath(nestedPackageDir);

    expect(resolvedStatePath).toBe(
      join(
        resolvedRepoRoot,
        ".libretto",
        "sessions",
        "browser-agent",
        "state.json",
      ),
    );
    expect(resolvedStatePath).not.toBe(
      join(
        resolvedNestedPackageDir,
        ".libretto",
        "sessions",
        "browser-agent",
        "state.json",
      ),
    );
  });
});
