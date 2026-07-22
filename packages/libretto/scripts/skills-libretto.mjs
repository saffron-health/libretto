#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from "node:fs";

export const SKILL_MIRRORS = [
  {
    name: "libretto",
    source: "packages/libretto/skills/libretto",
    targets: [".agents/skills/libretto", ".claude/skills/libretto"],
  },
  {
    name: "libretto-readonly",
    source: "packages/libretto/skills/libretto-readonly",
    targets: [
      ".agents/skills/libretto-readonly",
      ".claude/skills/libretto-readonly",
    ],
  },
];

export function syncSkillDir(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}
