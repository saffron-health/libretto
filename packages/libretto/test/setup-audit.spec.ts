import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditLibrettoSetup } from "../src/cli/core/setup-audit.js";

describe("auditLibrettoSetup", () => {
  it("does not warn when an agent root exists without a skills directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "libretto-setup-audit-"));
    await mkdir(join(repoRoot, ".agents"), { recursive: true });

    expect(auditLibrettoSetup(repoRoot, "0.5.2")).toEqual([]);
  });

  it("reports missing libretto skill directories inside existing skills roots", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "libretto-setup-audit-"));
    await mkdir(join(repoRoot, ".agents", "skills"), { recursive: true });

    expect(auditLibrettoSetup(repoRoot, "0.5.2")).toEqual([
      {
        agentDirName: ".agents",
        message: "Missing .agents/skills/libretto/.",
      },
    ]);
  });

  it("reports stale skill versions", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "libretto-setup-audit-"));
    const skillDir = join(repoRoot, ".claude", "skills", "libretto");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      ['---', 'name: libretto', 'version: "0.5.1"', '---'].join("\n"),
      "utf8",
    );

    expect(auditLibrettoSetup(repoRoot, "0.5.2")).toEqual([
      {
        agentDirName: ".claude",
        message: ".claude/skills/libretto is v0.5.1, but installed libretto is v0.5.2.",
      },
    ]);
  });
});
