#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { SKILL_DIRS } from "../../libretto/scripts/skills-libretto.mjs";

const README_TEMPLATE_PATH = "packages/libretto/README.template.md";
const README_GENERATED_HEADER =
  "<!-- Generated from packages/libretto/README.template.md by `pnpm sync:mirrors`. Do not edit directly. -->";
const PACKAGE_JSON_PATH = "packages/libretto/package.json";
const SKILL_SOURCE_PATH = "packages/libretto/skills/libretto/SKILL.md";

/**
 * @typedef {{
 *   name: string,
 *   kind: "directory",
 *   source: string,
 *   targets: string[],
 * }} DirectoryMirror
 */

/**
 * @typedef {{
 *   path: string,
 *   render: (source: string) => string,
 * }} FileMirrorTarget
 */

/**
 * @typedef {{
 *   name: string,
 *   kind: "file",
 *   source: string,
 *   targets: FileMirrorTarget[],
 * }} FileMirror
 */

/** @type {(DirectoryMirror | FileMirror)[]} */
export const MIRRORS = [
  {
    name: "skills",
    kind: "directory",
    source: SKILL_DIRS[0],
    targets: SKILL_DIRS.slice(1),
  },
  {
    name: "readmes",
    kind: "file",
    source: README_TEMPLATE_PATH,
    targets: [
      {
        path: "packages/libretto/README.md",
        render: (source) => renderReadme(source, ""),
      },
      {
        path: "README.md",
        render: (source) => renderReadme(source, "packages/libretto/"),
      },
    ],
  },
];

function walkFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
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

function normalizeText(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function getFrontmatterBlock(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  return {
    fullMatch: match[0],
    body: match[1],
    start: match.index,
  };
}

function updateFrontmatterBody(frontmatterBody, updateLine) {
  const lines = frontmatterBody.split("\n");
  let inMetadata = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!inMetadata) {
      if (line.trim() === "metadata:") {
        inMetadata = true;
      }
      continue;
    }

    if (/^\S/.test(line)) break;

    const updatedLine = updateLine(line);
    if (updatedLine) {
      lines[index] = updatedLine;
      return lines.join("\n");
    }
  }

  return null;
}

function findMetadataVersion(frontmatterBody) {
  const lines = frontmatterBody.split("\n");
  let inMetadata = false;

  for (const line of lines) {
    if (!inMetadata) {
      if (line.trim() === "metadata:") {
        inMetadata = true;
      }
      continue;
    }

    if (/^\S/.test(line)) break;

    const match = line.match(/^\s*version:\s*"?([^"\n]+)"?\s*$/);
    if (match) return match[1].trim();
  }

  return null;
}

function renderTemplate(template, variables) {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }

  const unreplacedTokens = rendered.match(/{{[A-Z0-9_]+}}/g);
  if (unreplacedTokens?.length) {
    throw new Error(
      `unreplaced template variables: ${[...new Set(unreplacedTokens)].join(", ")}`,
    );
  }

  return rendered;
}

function renderReadme(source, librettoPathPrefix) {
  const body = renderTemplate(source, {
    LIBRETTO_PATH_PREFIX: librettoPathPrefix,
  });
  return normalizeText(`${README_GENERATED_HEADER}\n\n${body}`);
}

export function getLibrettoSkillVersion(skillSource) {
  const frontmatter = getFrontmatterBlock(skillSource);
  if (!frontmatter) return null;
  return findMetadataVersion(frontmatter.body);
}

export function updateLibrettoSkillVersion(skillSource, version) {
  const frontmatter = getFrontmatterBlock(skillSource);
  if (!frontmatter) {
    throw new Error(`missing frontmatter in ${SKILL_SOURCE_PATH}`);
  }

  const updatedFrontmatterBody = updateFrontmatterBody(frontmatter.body, (line) => {
    const match = line.match(/^(\s*)version:\s*"?([^"\n]+)"?\s*$/);
    if (!match) return null;
    return `${match[1]}version: "${version}"`;
  });

  if (!updatedFrontmatterBody) {
    throw new Error(`could not find metadata.version in ${SKILL_SOURCE_PATH}`);
  }

  return `${skillSource.slice(0, frontmatter.start)}---\n${updatedFrontmatterBody}\n---${skillSource.slice(frontmatter.start + frontmatter.fullMatch.length)}`;
}

export function setLibrettoSkillVersion(repoRoot, version) {
  const skillPath = resolve(repoRoot, SKILL_SOURCE_PATH);
  const currentContent = readFileSync(skillPath, "utf8");
  writeFileSync(skillPath, updateLibrettoSkillVersion(currentContent, version), "utf8");
}

function syncDirectoryMirror(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}

function compareDirectoryMirror(mirror, repoRoot, issues) {
  const sourceDir = resolve(repoRoot, mirror.source);
  if (!existsSync(sourceDir)) {
    issues.push(`${mirror.name}: missing source directory: ${mirror.source}`);
    return;
  }

  const expectedFiles = walkFiles(sourceDir);
  const expectedFileSet = new Set(expectedFiles);

  for (const target of mirror.targets) {
    const targetDir = resolve(repoRoot, target);
    if (!existsSync(targetDir)) {
      issues.push(`${mirror.name}: missing directory: ${target}`);
      continue;
    }

    const actualFiles = walkFiles(targetDir);
    const actualFileSet = new Set(actualFiles);

    for (const file of expectedFiles) {
      if (!actualFileSet.has(file)) {
        issues.push(`${mirror.name}: ${target} is missing file: ${file}`);
      }
    }

    for (const file of actualFiles) {
      if (!expectedFileSet.has(file)) {
        issues.push(`${mirror.name}: ${target} has unexpected file: ${file}`);
      }
    }

    for (const file of expectedFiles) {
      const sourceFilePath = join(sourceDir, file);
      const targetFilePath = join(targetDir, file);
      if (!existsSync(targetFilePath)) continue;

      const expectedContent = readFileSync(sourceFilePath);
      const actualContent = readFileSync(targetFilePath);
      if (!expectedContent.equals(actualContent)) {
        issues.push(`${mirror.name}: ${target} differs from ${mirror.source}: ${file}`);
      }
    }
  }
}

function compareFileMirror(mirror, repoRoot, issues) {
  const sourcePath = resolve(repoRoot, mirror.source);
  if (!existsSync(sourcePath)) {
    issues.push(`${mirror.name}: missing source file: ${mirror.source}`);
    return;
  }

  const source = readFileSync(sourcePath, "utf8");
  for (const target of mirror.targets) {
    const targetPath = resolve(repoRoot, target.path);
    if (!existsSync(targetPath)) {
      issues.push(`${mirror.name}: missing file: ${target.path}`);
      continue;
    }

    const expectedContent = target.render(source);
    const actualContent = normalizeText(readFileSync(targetPath, "utf8"));
    if (expectedContent !== actualContent) {
      issues.push(`${mirror.name}: ${target.path} differs from ${mirror.source}`);
    }
  }
}

function getSkillVersionIssue(repoRoot) {
  const packageJson = JSON.parse(
    readFileSync(resolve(repoRoot, PACKAGE_JSON_PATH), "utf8"),
  );
  const skillSource = readFileSync(resolve(repoRoot, SKILL_SOURCE_PATH), "utf8");
  const skillVersion = getLibrettoSkillVersion(skillSource);

  if (!skillVersion) {
    return `validation: could not find metadata.version in ${SKILL_SOURCE_PATH}`;
  }

  if (skillVersion !== packageJson.version) {
    return `validation: ${SKILL_SOURCE_PATH} metadata.version (${skillVersion}) must match ${PACKAGE_JSON_PATH} version (${packageJson.version})`;
  }

  return null;
}

export function compareMirrors(repoRoot) {
  const issues = [];

  for (const mirror of MIRRORS) {
    if (mirror.kind === "directory") {
      compareDirectoryMirror(mirror, repoRoot, issues);
      continue;
    }

    compareFileMirror(mirror, repoRoot, issues);
  }

  const skillVersionIssue = getSkillVersionIssue(repoRoot);
  if (skillVersionIssue) issues.push(skillVersionIssue);

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function syncMirrors(repoRoot) {
  for (const mirror of MIRRORS) {
    if (mirror.kind === "directory") {
      const sourceDir = resolve(repoRoot, mirror.source);
      if (!existsSync(sourceDir)) {
        throw new Error(`missing source directory: ${mirror.source}`);
      }

      for (const target of mirror.targets) {
        syncDirectoryMirror(sourceDir, resolve(repoRoot, target));
      }
      continue;
    }

    const sourcePath = resolve(repoRoot, mirror.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`missing source file: ${mirror.source}`);
    }

    const source = readFileSync(sourcePath, "utf8");
    for (const target of mirror.targets) {
      const targetPath = resolve(repoRoot, target.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, target.render(source), "utf8");
    }
  }

  const result = compareMirrors(repoRoot);
  if (!result.ok) {
    throw new Error(result.issues.join("\n"));
  }
}
