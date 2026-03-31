#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from "node:fs";

export const SKILL_DIRS = [
  "packages/libretto/skills/libretto",
  ".agents/skills/libretto",
  ".claude/skills/libretto",
];

export function syncSkillDir(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}
