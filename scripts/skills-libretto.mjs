#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { relative, resolve, join } from "node:path";

export const SKILL_DIRS = [
  "skills/libretto",
  ".agents/skills/libretto",
  ".claude/skills/libretto",
];

function walkFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, baseDir));
      continue;
    }
    if (entry.isFile()) files.push(relative(baseDir, fullPath));
  }

  return files;
}

export function syncSkillDir(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}

export function syncRepoSkills(repoRoot) {
  const sourceDir = resolve(repoRoot, "skills/libretto");
  for (const dir of SKILL_DIRS.slice(1)) {
    syncSkillDir(sourceDir, resolve(repoRoot, dir));
  }
}

export function compareSkillDirs(repoRoot) {
  const roots = SKILL_DIRS.map((dir) => ({
    label: dir,
    absPath: resolve(repoRoot, dir),
  }));
  const missing = roots.filter(({ absPath }) => !existsSync(absPath));
  const mismatches = [];

  if (missing.length > 0) {
    return {
      ok: false,
      issues: missing.map(({ label }) => `missing directory: ${label}`),
    };
  }

  const expectedFiles = walkFiles(roots[0].absPath);
  const expectedFileSet = new Set(expectedFiles);

  for (const root of roots.slice(1)) {
    const actualFiles = walkFiles(root.absPath);
    const actualFileSet = new Set(actualFiles);

    for (const file of expectedFiles) {
      if (!actualFileSet.has(file)) {
        mismatches.push(`${root.label} is missing file: ${file}`);
      }
    }

    for (const file of actualFiles) {
      if (!expectedFileSet.has(file)) {
        mismatches.push(`${root.label} has unexpected file: ${file}`);
      }
    }
  }

  for (const file of expectedFiles) {
    const expectedContent = readFileSync(join(roots[0].absPath, file));
    for (const root of roots.slice(1)) {
      const targetPath = join(root.absPath, file);
      if (!existsSync(targetPath)) continue;
      const actualContent = readFileSync(targetPath);
      if (!expectedContent.equals(actualContent)) {
        mismatches.push(`${root.label} differs from ${roots[0].label}: ${file}`);
      }
    }
  }

  return {
    ok: mismatches.length === 0,
    issues: mismatches,
  };
}
