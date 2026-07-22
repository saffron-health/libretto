#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from "node:fs";

export const SKILL_MIRRORS = [
  {
    name: "libretto",
    source: "packages/libretto/skills/libretto",
    targets: [".agents/skills/libretto", ".claude/skills/libretto"],
    syncPackageVersion: true,
  },
  {
    name: "libretto-readonly",
    source: "packages/libretto/skills/libretto-readonly",
    targets: [
      ".agents/skills/libretto-readonly",
      ".claude/skills/libretto-readonly",
    ],
    syncPackageVersion: true,
  },
  {
    name: "errore",
    source: "packages/libretto/skills/errore",
    targets: [".agents/skills/errore", ".claude/skills/errore"],
    syncPackageVersion: false,
  },
];

export function syncSkillDir(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}
