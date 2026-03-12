import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { test as base } from "vitest";
import { ClaudeEvalHarness, ensureClaudeAuthConfigured } from "./harness.js";

type EvalFixtures = {
  harness: ClaudeEvalHarness;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = packageRoot;
const skillPath = resolve(packageRoot, ".agents/skills/libretto/SKILL.md");

let cachedSkillMarkdown: string | null = null;

async function getSkillMarkdown(): Promise<string> {
  if (cachedSkillMarkdown !== null) return cachedSkillMarkdown;
  cachedSkillMarkdown = await readFile(skillPath, "utf8");
  return cachedSkillMarkdown;
}

export const test = base.extend<EvalFixtures>({
  harness: async ({}, use) => {
    ensureClaudeAuthConfigured();
    const harness = new ClaudeEvalHarness({
      cwd: repoRoot,
      model: process.env.LIBRETTO_EVAL_MODEL?.trim() || undefined,
      librettoSkillMarkdown: await getSkillMarkdown(),
    });
    try {
      await use(harness);
    } finally {
      await harness.close();
    }
  },
});

export { expect } from "vitest";
