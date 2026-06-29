#!/usr/bin/env node
// @bun

// scripts/render-md.ts
import { execSync, spawn } from "child_process";
import { randomBytes } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import process from "process";
import { open } from "glimpseui";
var scriptDir = dirname(fileURLToPath(import.meta.url));
var skillDir = dirname(scriptDir);
var assetsDir = join(skillDir, "assets");
var DEFAULT_DIFFS_MODULE_URL = "https://esm.sh/@pierre/diffs@1.1.1?bundle";
var DEFAULT_DIFFS_SSR_MODULE_URL = "https://esm.sh/@pierre/diffs@1.1.1/ssr?bundle";
var DEFAULT_WIDTH = 1600;
var DEFAULT_HEIGHT = 920;
function printUsage() {
  console.log(`glimpse-changes [options] [markdown]

Render Markdown into a styled HTML page and open it in a Glimpse window.
Blocks until the window is closed.

Options:
  --dry-run      Render to file only, don't open Glimpse
  --background   Open window in background, print output file path, exit immediately

Input:
  - Prefer piping Markdown over stdin (for example with a heredoc), or
  - pass a single inline Markdown argument for simple content.

Tips:
  - Use '-' to force reading from stdin: npx glimpse-changes -
`);
}
function parseInput(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--") || a === "-h"));
  const positional = argv.filter((a) => !a.startsWith("--") && a !== "-h");
  if (flags.has("--help") || flags.has("-h")) {
    printUsage();
    process.exit(0);
  }
  const dryRun = flags.has("--dry-run");
  const background = flags.has("--background");
  if (positional.length > 1) {
    throw new Error("Expected a single inline Markdown argument or stdin.");
  }
  const input = positional[0] ?? null;
  const readFromStdin = input === "-";
  return {
    markdown: readFromStdin ? null : input,
    readFromStdin,
    dryRun,
    background
  };
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "section";
}
function encodeBase64Utf8(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
function formatUnifiedRange(start, count) {
  if (count === 1)
    return `${start}`;
  if (count === 0)
    return `${start},0`;
  return `${start},${count}`;
}
function isValidUnifiedHunkHeader(line) {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line);
}
function isMalformedHunkHeader(line) {
  return /^@@(?:\s.*)?$/.test(line) && !isValidUnifiedHunkHeader(line);
}
function normalizePatchForDiffs(patch) {
  const lines = patch.replace(/\r\n/g, `
`).split(`
`);
  const normalized = [];
  let index = 0;
  let oldStart = 1;
  let newStart = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("diff --git ")) {
      oldStart = 1;
      newStart = 1;
      normalized.push(line);
      index += 1;
      continue;
    }
    if (!isMalformedHunkHeader(line)) {
      normalized.push(line);
      index += 1;
      continue;
    }
    const hunkLines = [];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (next.startsWith("diff --git ") || next.startsWith("@@"))
        break;
      hunkLines.push(next);
      index += 1;
    }
    let oldCount = 0;
    let newCount = 0;
    for (const hunkLine of hunkLines) {
      if (hunkLine.startsWith("+") && !hunkLine.startsWith("+++")) {
        newCount += 1;
      } else if (hunkLine.startsWith("-") && !hunkLine.startsWith("---")) {
        oldCount += 1;
      } else {
        oldCount += 1;
        newCount += 1;
      }
    }
    normalized.push(`@@ -${formatUnifiedRange(oldStart, oldCount)} +${formatUnifiedRange(newStart, newCount)} @@`);
    normalized.push(...hunkLines);
    oldStart += oldCount;
    newStart += newCount;
  }
  return normalized.join(`
`);
}
function parseInline(text) {
  const codeSpans = [];
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_, code) => {
    const key = `__CODE_${codeSpans.length}__`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return key;
  });
  let escaped = escapeHtml(withPlaceholders);
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = escapeHtml(href);
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (_, lead, href) => {
    const safeHref = escapeHtml(href);
    return `${lead}<a href="${safeHref}" target="_blank" rel="noreferrer">${safeHref}</a>`;
  });
  return codeSpans.reduce((result, html, index) => result.replace(`__CODE_${index}__`, html), escaped);
}
function renderLoadingIndicator() {
  return `<div class="glimpse-loading"><div class="glimpse-spinner"></div><span>Loading diff\u2026</span></div>`;
}
function renderDiffBlock(code) {
  const patchBase64 = encodeBase64Utf8(normalizePatchForDiffs(code));
  return `<div class="diff-shell" data-diff-shell data-diff-patch="${patchBase64}" data-render-state="loading">
    ${renderLoadingIndicator()}
    <div class="diff-mount" data-diff-hosts></div>
  </div>`;
}
function renderPlainCodeBlock(code, language) {
  const lang = (language || "").trim().toLowerCase();
  const contentsBase64 = encodeBase64Utf8(code.replace(/\n$/, ""));
  const filename = lang ? `file.${lang}` : "file.txt";
  return `<div class="code-shell" data-code-shell data-code-contents="${contentsBase64}" data-code-filename="${escapeHtml(filename)}" data-code-lang="${escapeHtml(lang || "text")}" data-render-state="loading">${renderLoadingIndicator()}<div class="code-label">${escapeHtml(lang || "text")}</div><pre class="code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre></div>`;
}
function renderChangesBlock(code) {
  const lines = code.split(`
`).filter((l) => l.trim() !== "");
  const fileHtmlParts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const rangeMatch = /^(.+):([0-9]+)-([0-9]+)$/.exec(trimmed);
    const filepath = rangeMatch ? rangeMatch[1] : trimmed;
    const focusStart = rangeMatch ? rangeMatch[2] : "";
    const focusEnd = rangeMatch ? rangeMatch[3] : "";
    let oldContents = null;
    let newContents = null;
    try {
      oldContents = execSync(`git show HEAD:./${filepath}`, {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024
      });
    } catch {
      oldContents = null;
    }
    try {
      newContents = readFileSync(filepath, "utf8");
    } catch {
      newContents = null;
    }
    if (oldContents === null && newContents === null) {
      fileHtmlParts.push(`<div class="changes-file-error">Could not resolve: ${escapeHtml(filepath)}</div>`);
      continue;
    }
    let statAdded = 0;
    let statRemoved = 0;
    try {
      const numstat = execSync(`git diff --numstat -- ${JSON.stringify(filepath)}`, {
        encoding: "utf8"
      }).trim();
      if (numstat) {
        const parts = numstat.split("\t");
        statAdded = parseInt(parts[0], 10) || 0;
        statRemoved = parseInt(parts[1], 10) || 0;
      }
    } catch {
      if (oldContents === null && newContents !== null) {
        statAdded = newContents.split(`
`).length;
      } else if (oldContents !== null && newContents === null) {
        statRemoved = oldContents.split(`
`).length;
      }
    }
    const attrs = [
      `data-file-name="${escapeHtml(filepath)}"`,
      oldContents !== null ? `data-old-contents="${encodeBase64Utf8(oldContents)}"` : null,
      newContents !== null ? `data-new-contents="${encodeBase64Utf8(newContents)}"` : null,
      `data-focus-start="${escapeHtml(focusStart)}"`,
      `data-focus-end="${escapeHtml(focusEnd)}"`,
      `data-stat-added="${statAdded}"`,
      `data-stat-removed="${statRemoved}"`
    ].filter(Boolean).join(" ");
    fileHtmlParts.push(`<div class="changes-file" ${attrs} data-render-state="loading">
    <div class="changes-file-header">
      <span class="changes-file-path">${escapeHtml(filepath)}</span>
      <div class="diff-header-spinner"><div class="glimpse-spinner"></div></div>
      <span class="diff-stat">${statAdded > 0 ? `<span class="diff-stat-add">+${statAdded}</span>` : ""}${statRemoved > 0 ? `<span class="diff-stat-remove">&#x2212;${statRemoved}</span>` : ""}</span>
      <button class="diff-toggle" title="Toggle diff" onclick="this.closest('.changes-file').classList.toggle('collapsed')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"></polyline></svg>
      </button>
    </div>
    ${renderLoadingIndicator()}
    <div class="changes-mount"></div>
  </div>`);
  }
  return `<div class="changes-shell" data-changes-shell>
  ${fileHtmlParts.join(`
  `)}
</div>`;
}
function hasUnifiedDiffStructure(lines) {
  return lines.some((line) => line.startsWith("diff --git ") || isValidUnifiedHunkHeader(line));
}
function isInlineDiffCandidate(lines) {
  const nonEmptyLines = lines.filter((line) => line !== "");
  return nonEmptyLines.length > 0 && nonEmptyLines.every((line) => /^[+\- ]/.test(line));
}
function normalizeInlineDiffPath(path) {
  return path.trim().replace(/^[ab]\//, "");
}
function tryWrapInlineFileDiffAsUnified(lines) {
  const firstLine = lines[0] ?? "";
  const addedFileMatch = /^\+\+\+\s+(.+)$/.exec(firstLine);
  if (addedFileMatch) {
    const filename = normalizeInlineDiffPath(addedFileMatch[1]);
    const bodyLines = lines.slice(1);
    const hasOnlyAdditions = bodyLines.every((line) => line === "" || line.startsWith("+"));
    if (filename && bodyLines.length > 0 && hasOnlyAdditions) {
      const newCount = bodyLines.filter((line) => line !== "").length;
      return [
        `diff --git a/${filename} b/${filename}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${filename}`,
        `@@ -0,0 +${formatUnifiedRange(1, newCount)} @@`,
        ...bodyLines
      ].join(`
`);
    }
  }
  const deletedFileMatch = /^---\s+(.+)$/.exec(firstLine);
  if (deletedFileMatch) {
    const filename = normalizeInlineDiffPath(deletedFileMatch[1]);
    const bodyLines = lines.slice(1);
    const hasOnlyRemovals = bodyLines.every((line) => line === "" || line.startsWith("-"));
    if (filename && bodyLines.length > 0 && hasOnlyRemovals) {
      const oldCount = bodyLines.filter((line) => line !== "").length;
      return [
        `diff --git a/${filename} b/${filename}`,
        "deleted file mode 100644",
        `--- a/${filename}`,
        "+++ /dev/null",
        `@@ -${formatUnifiedRange(1, oldCount)} +0,0 @@`,
        ...bodyLines
      ].join(`
`);
    }
  }
  return null;
}
function validateInlineDiffLines(lines) {
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    if (line === "")
      continue;
    if (/^[+\- ]/.test(line))
      continue;
    throw new Error(`Invalid inline diff at line ${i + 1}: every non-empty line must start with '+', '-', or ' ' (space). Got: ${JSON.stringify(line)}`);
  }
}
function wrapInlineDiffAsUnified(code) {
  const lines = code.replace(/\n$/, "").split(`
`);
  const filePatch = tryWrapInlineFileDiffAsUnified(lines);
  if (filePatch) {
    return filePatch;
  }
  validateInlineDiffLines(lines);
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line === "")
      continue;
    const prefix = line[0];
    if (prefix === "-") {
      oldCount += 1;
    } else if (prefix === "+") {
      newCount += 1;
    } else {
      oldCount += 1;
      newCount += 1;
    }
  }
  const header = [
    "diff --git a/file b/file",
    "--- a/file",
    "+++ b/file",
    `@@ -${formatUnifiedRange(1, oldCount)} +${formatUnifiedRange(1, newCount)} @@`
  ];
  return [...header, ...lines].join(`
`);
}
function renderCodeBlock(code, language) {
  const lang = (language || "").trim().toLowerCase();
  const lines = code.replace(/\n$/, "").split(`
`);
  if (lang === "diff") {
    if (hasUnifiedDiffStructure(lines)) {
      return renderDiffBlock(code);
    }
    return renderDiffBlock(wrapInlineDiffAsUnified(code));
  }
  const isDiff = hasUnifiedDiffStructure(lines) || isInlineDiffCandidate(lines);
  if (isDiff) {
    return renderDiffBlock(code);
  }
  return renderPlainCodeBlock(code, language);
}
function parseFenceOpen(trimmed) {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (!match)
    return null;
  return {
    markerChar: match[1][0],
    markerLength: match[1].length,
    language: match[2].trim()
  };
}
function isFenceClose(trimmed, opener) {
  const close = new RegExp(`^${opener.markerChar}{${opener.markerLength},}\\s*$`);
  return close.test(trimmed);
}
function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, `
`).split(`
`);
  const html = [];
  const headings = [];
  let index = 0;
  let blockIndex = 0;
  const isBlockBoundary = (line) => line.trim() === "" || /^#{1,6}\s+/.test(line) || /^(`{3,}|~{3,})/.test(line) || /^>\s?/.test(line) || /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^([-*_])\1{2,}\s*$/.test(line) || /^\|(.+)\|/.test(line.trim());
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "") {
      index += 1;
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugify(text);
      if (level <= 3)
        headings.push({ level, text, id });
      html.push(`<h${level} id="${id}" data-block-index="${blockIndex++}">${parseInline(text)}</h${level}>`);
      index += 1;
      continue;
    }
    const fenceOpen = parseFenceOpen(trimmed);
    if (fenceOpen) {
      const buffer = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index].trim(), fenceOpen)) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length)
        index += 1;
      if (fenceOpen.language === "changes") {
        html.push(renderChangesBlock(buffer.join(`
`)));
      } else {
        html.push(renderCodeBlock(buffer.join(`
`), fenceOpen.language));
      }
      continue;
    }
    if (/^([-*_])\1{2,}\s*$/.test(trimmed)) {
      html.push("<hr />");
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote data-block-index="${blockIndex++}">${quoteLines.map((quoteLine) => parseInline(quoteLine)).join("<br />")}</blockquote>`);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li data-block-index="${blockIndex++}">${parseInline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li data-block-index="${blockIndex++}">${parseInline(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^\|(.+)\|/.test(trimmed) && index + 1 < lines.length && /^\|[\s:]*-+[\s:]*/.test(lines[index + 1].trim())) {
      const tableRows = [];
      while (index < lines.length && /^\|(.+)\|/.test(lines[index].trim())) {
        tableRows.push(lines[index].trim());
        index += 1;
      }
      if (tableRows.length >= 2) {
        const parseRow = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
        const headerCells = parseRow(tableRows[0]);
        const separatorCells = parseRow(tableRows[1]);
        const alignments = separatorCells.map((cell) => {
          const left = cell.startsWith(":");
          const right = cell.endsWith(":");
          if (left && right)
            return "center";
          if (right)
            return "right";
          return "left";
        });
        const thead = `<thead><tr>${headerCells.map((cell, i) => `<th align="${alignments[i] || "left"}">${parseInline(cell)}</th>`).join("")}</tr></thead>`;
        const bodyRows = tableRows.slice(2).map((row) => {
          const cells = parseRow(row);
          return `<tr>${cells.map((cell, i) => `<td align="${alignments[i] || "left"}">${parseInline(cell)}</td>`).join("")}</tr>`;
        });
        const tbody = bodyRows.length > 0 ? `<tbody>${bodyRows.join("")}</tbody>` : "";
        html.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }
    const paragraph = [];
    while (index < lines.length && !isBlockBoundary(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p data-block-index="${blockIndex++}">${parseInline(paragraph.join(" "))}</p>`);
  }
  return { html: html.join(`
`), headings };
}
function getLightTheme() {
  return {
    primary: "#0043ff",
    secondary: "#750054",
    accent: "#0043ff",
    text: "#000000",
    textMuted: "rgba(0,0,0,0.47)",
    background: "hsl(60, 30%, 99%)",
    backgroundPanel: "hsl(60, 10%, 96%)",
    backgroundElement: "hsl(60, 8%, 92%)",
    border: "hsl(60, 5%, 82%)",
    borderActive: "#0043ff",
    borderSubtle: "hsl(60, 5%, 87%)",
    diffAdded: "#116432",
    diffRemoved: "#cf222e",
    diffContext: "rgba(0,0,0,0.47)",
    diffHunkHeader: "#0043a8",
    diffAddedBg: "hsl(144, 40%, 93%)",
    diffRemovedBg: "hsl(5, 50%, 95%)",
    diffContextBg: "hsl(60, 10%, 96%)",
    diffLineNumber: "rgba(0,0,0,0.25)",
    markdownHeading: "#000000",
    markdownLink: "#0043ff",
    markdownCode: "#0043a8",
    markdownBlockQuote: "#116432",
    markdownHorizontalRule: "hsl(60, 5%, 82%)",
    selectionBg: "hsla(204, 100%, 83%, 0.5)",
    selectionText: "inherit"
  };
}
function getDarkTheme() {
  return {
    primary: "hsl(320, 90%, 70%)",
    secondary: "hsl(27, 100%, 87%)",
    accent: "hsl(320, 90%, 70%)",
    text: "rgba(255,255,255,0.8)",
    textMuted: "rgba(255,255,255,0.35)",
    background: "hsl(0, 0%, 7%)",
    backgroundPanel: "hsl(0, 0%, 10%)",
    backgroundElement: "hsl(0, 0%, 14%)",
    border: "hsl(0, 0%, 20%)",
    borderActive: "hsl(320, 90%, 70%)",
    borderSubtle: "hsl(0, 0%, 16%)",
    diffAdded: "hsl(150, 100%, 43%)",
    diffRemoved: "hsl(5, 100%, 50%)",
    diffContext: "rgba(255,255,255,0.35)",
    diffHunkHeader: "hsl(180, 100%, 50%)",
    diffAddedBg: "hsla(150, 100%, 43%, 0.1)",
    diffRemovedBg: "hsla(5, 100%, 50%, 0.1)",
    diffContextBg: "hsl(0, 0%, 10%)",
    diffLineNumber: "rgba(255,255,255,0.3)",
    markdownHeading: "#ffffff",
    markdownLink: "hsl(320, 90%, 70%)",
    markdownCode: "hsl(27, 100%, 87%)",
    markdownBlockQuote: "hsl(150, 40%, 70%)",
    markdownHorizontalRule: "hsl(0, 0%, 20%)",
    selectionBg: "hsla(204, 100%, 70%, 0.3)",
    selectionText: "inherit"
  };
}
function loadCssAssets() {
  return {
    baseCss: readFileSync(join(assetsDir, "critique-base.css"), "utf8"),
    markdownCss: readFileSync(join(assetsDir, "critique-markdown.css"), "utf8"),
    annotationsCss: readFileSync(join(assetsDir, "annotations.css"), "utf8")
  };
}
function loadAnnotationsScript() {
  return readFileSync(join(assetsDir, "annotations.js"), "utf8");
}
function loadFontFaceCss() {
  const fontPath = join(assetsDir, "jetbrains-mono-nerd.woff2");
  if (!existsSync(fontPath))
    return "";
  const fontBase64 = readFileSync(fontPath).toString("base64");
  return `@font-face {
  font-family: 'JetBrains Mono Nerd';
  src: url(data:font/woff2;base64,${fontBase64}) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`;
}
function createDiffBootScript(moduleUrl, ssrModuleUrl) {
  return `<script type="module">
const moduleUrl = ${JSON.stringify(moduleUrl)};
const ssrModuleUrl = ${JSON.stringify(ssrModuleUrl)};
const defaults = {
  diffStyle: "split",
  overflow: "wrap",
  diffIndicators: "none",
  lineDiffType: "word-alt",
  hunkSeparators: "line-info",
  showLineNumbers: true,
  showBackground: true,
  showFileHeader: false,
  unifiedWidth: 80,
  splitPaneWidth: 70,
  maxHeight: 60,
};
const shellStates = [];
const diffUnsafeCss = \`
[data-column-number] {
  box-sizing: border-box !important;
  width: calc(var(--diffs-min-number-column-width-default, 2ch) + 1ch) !important;
  min-width: calc(var(--diffs-min-number-column-width-default, 2ch) + 1ch) !important;
  padding-left: 0 !important;
  padding-right: 1ch !important;
  text-align: right !important;
  font-variant-numeric: tabular-nums lining-nums !important;
}

[data-line-number-content] {
  display: block !important;
  font-variant-numeric: inherit !important;
}
\`;

const changesUnsafeCss = \`
[data-column-number] {
  box-sizing: border-box !important;
  width: calc(var(--diffs-min-number-column-width-default, 2ch) + 1ch) !important;
  min-width: calc(var(--diffs-min-number-column-width-default, 2ch) + 1ch) !important;
  padding-left: 0 !important;
  padding-right: 1ch !important;
  text-align: right !important;
  font-variant-numeric: tabular-nums lining-nums !important;
}

[data-line-number-content] {
  display: block !important;
  font-variant-numeric: inherit !important;
}

[data-expand-button] {
  cursor: pointer !important;
  color: var(--muted) !important;
  transition: color 0.15s !important;
}

[data-expand-button]:hover {
  color: var(--primary) !important;
}

[data-expand-button] svg {
  width: 16px !important;
  height: 16px !important;
  opacity: 0.7 !important;
  transition: opacity 0.15s !important;
}

[data-expand-button]:hover svg {
  opacity: 1 !important;
}

[data-separator-content] {
  color: var(--muted) !important;
}
\`;

// rsms/sublime-theme color schemes for @pierre/diffs syntax highlighting
const rsmsDarkTheme = {
  name: "rsms-dark",
  type: "dark",
  colors: {
    "editor.background": "hsl(0, 0%, 7%)",
    "editor.foreground": "rgba(255,255,255,0.8)",
    "editor.lineHighlightBackground": "rgba(255,255,255,0.06)",
    "editorLineNumber.foreground": "rgba(255,255,255,0.3)",
    "gitDecoration.addedResourceForeground": "hsl(150, 100%, 43%)",
    "gitDecoration.deletedResourceForeground": "hsl(5, 100%, 50%)",
    "gitDecoration.modifiedResourceForeground": "hsl(210, 100%, 50%)",
    "terminal.ansiGreen": "hsl(150, 100%, 43%)",
    "terminal.ansiRed": "hsl(5, 100%, 50%)",
    "terminal.ansiBlue": "hsl(210, 100%, 50%)",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "rgba(255,255,255,0.35)" } },
    { scope: ["punctuation", "meta.brace", "meta.delimiter"], settings: { foreground: "rgba(255,255,255,0.4)" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#93b2d1" } },
    { scope: ["keyword.operator"], settings: { foreground: "#e8c4a0" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#93d1b2" } },
    { scope: ["constant.numeric"], settings: { foreground: "#93d1b2" } },
    { scope: ["constant.language"], settings: { foreground: "#93b2d1" } },
    { scope: ["entity.name.type", "support.type", "storage.type.interface", "storage.type.type"], settings: { foreground: "#ffdabc" } },
    { scope: ["entity.name.function", "entity.name.class", "entity.name.type.class", "support.function"], settings: { foreground: "#ffffff", fontStyle: "bold" } },
    { scope: ["variable", "variable.other", "meta.object-literal.key"], settings: { foreground: "rgba(255,255,255,0.8)" } },
    { scope: ["variable.parameter"], settings: { foreground: "rgba(255,255,255,0.8)" } },
    { scope: ["support.class", "entity.other.inherited-class"], settings: { foreground: "#ffdabc" } },
    { scope: ["meta.import", "meta.export", "keyword.control.import", "keyword.control.export", "keyword.control.from"], settings: { foreground: "#93b2d1" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#93b2d1" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#ffdabc" } },
    { scope: ["markup.deleted"], settings: { foreground: "hsl(5, 100%, 50%)" } },
    { scope: ["markup.inserted"], settings: { foreground: "hsl(150, 100%, 43%)" } },
  ],
};

const rsmsLightTheme = {
  name: "rsms-light",
  type: "light",
  colors: {
    "editor.background": "hsl(60, 30%, 99%)",
    "editor.foreground": "#000000",
    "editor.lineHighlightBackground": "hsla(60, 100%, 50%, 0.12)",
    "editorLineNumber.foreground": "rgba(0,0,0,0.25)",
    "gitDecoration.addedResourceForeground": "#116432",
    "gitDecoration.deletedResourceForeground": "#cf222e",
    "gitDecoration.modifiedResourceForeground": "#0043a8",
    "terminal.ansiGreen": "#116432",
    "terminal.ansiRed": "#cf222e",
    "terminal.ansiBlue": "#0043a8",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "rgba(0,0,0,0.47)", fontStyle: "italic" } },
    { scope: ["punctuation", "meta.brace", "meta.delimiter"], settings: { foreground: "rgba(0,0,0,0.5)" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "rgba(0,0,0,0.6)" } },
    { scope: ["keyword.control"], settings: { foreground: "hsla(240, 100%, 23%, 0.67)" } },
    { scope: ["keyword.operator"], settings: { foreground: "rgba(0,0,0,0.6)" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#116432" } },
    { scope: ["constant.numeric"], settings: { foreground: "#750054" } },
    { scope: ["constant.language"], settings: { foreground: "rgba(0,0,0,0.6)" } },
    { scope: ["entity.name.type", "support.type", "storage.type.interface", "storage.type.type"], settings: { foreground: "#0043a8" } },
    { scope: ["entity.name.function", "entity.name.class", "entity.name.type.class", "support.function"], settings: { foreground: "#000000", fontStyle: "bold" } },
    { scope: ["variable", "variable.other", "meta.object-literal.key"], settings: { foreground: "#000000" } },
    { scope: ["variable.parameter"], settings: { foreground: "#000000" } },
    { scope: ["support.class", "entity.other.inherited-class"], settings: { foreground: "#0043a8" } },
    { scope: ["meta.import", "meta.export", "keyword.control.import", "keyword.control.export", "keyword.control.from"], settings: { foreground: "rgba(0,0,0,0.6)" } },
    { scope: ["entity.name.tag"], settings: { foreground: "rgba(0,0,0,0.6)" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#0043a8" } },
    { scope: ["markup.deleted"], settings: { foreground: "#cf222e" } },
    { scope: ["markup.inserted"], settings: { foreground: "#116432" } },
  ],
};

const rsmsThemeOption = { dark: "rsms-dark", light: "rsms-light" };

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function applyLayoutState(state) {
  document.body.dataset.diffStyle = state.diffStyle;
  document.documentElement.style.setProperty("--diff-unified-width", \`\${state.unifiedWidth}ch\`);
  document.documentElement.style.setProperty("--diff-split-pane-width", \`\${state.splitPaneWidth}ch\`);
  document.documentElement.style.setProperty("--diff-shell-max-height", \`\${state.maxHeight}vh\`);
}

function createViewOptions(state) {
  return {
    diffStyle: state.diffStyle,
    overflow: state.overflow,
    diffIndicators: state.diffIndicators,
    lineDiffType: state.lineDiffType,
    hunkSeparators: state.hunkSeparators,
    disableLineNumbers: !state.showLineNumbers,
    disableBackground: !state.showBackground,
    disableFileHeader: !state.showFileHeader,
    theme: rsmsThemeOption,
    themeType: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    unsafeCSS: diffUnsafeCss,
  };
}

function countPatchStats(patch) {
  // Split a multi-file patch into per-file sections, count +/- lines per file
  const fileStats = [];
  const sections = patch.split(/^(?=diff --git )/m);
  for (const section of sections) {
    if (!section.trim()) continue;
    const nameMatch = /^diff --git a\\/.+ b\\/(.+)$/m.exec(section);
    const name = nameMatch ? nameMatch[1] : null;
    let added = 0, removed = 0;
    const lines = section.split("\\n");
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    fileStats.push({ name, added, removed });
  }
  return fileStats;
}

function createFileHeader(fileName, fileStat, wrapper) {
  const headerRow = document.createElement("div");
  headerRow.className = "diff-header-row";

  const pathLabel = document.createElement("div");
  pathLabel.className = "diff-path-label";
  pathLabel.textContent = fileName;
  headerRow.append(pathLabel);

  // Inline loading spinner
  const spinner = document.createElement("div");
  spinner.className = "diff-header-spinner";
  spinner.innerHTML = '<div class="glimpse-spinner"></div>';
  headerRow.append(spinner);

  // +N -M stats
  const stat = document.createElement("span");
  stat.className = "diff-stat";
  if (fileStat.added > 0) {
    const addSpan = document.createElement("span");
    addSpan.className = "diff-stat-add";
    addSpan.textContent = "+" + fileStat.added;
    stat.append(addSpan);
  }
  if (fileStat.removed > 0) {
    const rmSpan = document.createElement("span");
    rmSpan.className = "diff-stat-remove";
    rmSpan.textContent = "\\u2212" + fileStat.removed;
    stat.append(rmSpan);
  }
  headerRow.append(stat);

  // Collapse/expand chevron
  const toggle = document.createElement("button");
  toggle.className = "diff-toggle";
  toggle.title = "Toggle diff";
  toggle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"></polyline></svg>';
  toggle.addEventListener("click", () => {
    wrapper.classList.toggle("collapsed");
  });
  headerRow.append(toggle);

  return { headerRow, spinner };
}

async function renderShell(shellState, preloadPatchFile, renderHTML, state) {
  shellState.mount.replaceChildren();
  shellState.shell.dataset.renderState = "loading";

  const patchStats = countPatchStats(shellState.patch);

  // Create placeholder headers immediately so file names + spinners are visible while loading
  const placeholders = patchStats.map((fileStat, fi) => {
    const wrapper = document.createElement("div");
    wrapper.className = "diff-file-block";
    const { headerRow, spinner } = createFileHeader(fileStat.name || "file", fileStat, wrapper);
    wrapper.append(headerRow);
    shellState.mount.append(wrapper);
    return { wrapper, spinner };
  });

  const files = await preloadPatchFile({
    patch: shellState.patch,
    options: createViewOptions(state),
  });
  if (files.length === 0) {
    shellState.mount.replaceChildren();
    shellState.shell.dataset.renderState = "empty";
    return;
  }

  // If placeholder count doesn't match (e.g. inline diff with no diff --git header), rebuild
  if (placeholders.length !== files.length) {
    shellState.mount.replaceChildren();
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      const fileName = file.fileDiff?.name || file.fileDiff?.prevName || "file";
      const fileStat = patchStats.find(s => s.name === fileName) || patchStats[fi] || { added: 0, removed: 0 };
      const wrapper = document.createElement("div");
      wrapper.className = "diff-file-block";
      const { headerRow } = createFileHeader(fileName, fileStat, wrapper);
      wrapper.append(headerRow);
      const scroll = document.createElement("div");
      scroll.className = "diff-scroll";
      const host = document.createElement("div");
      host.className = "diffs-host";
      host.innerHTML = Array.isArray(file.prerenderedHTML)
        ? renderHTML(file.prerenderedHTML)
        : String(file.prerenderedHTML || "");
      scroll.append(host);
      wrapper.append(scroll);
      shellState.mount.append(wrapper);
    }
  } else {
    // Fill in diff content into existing placeholders
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      const { wrapper, spinner } = placeholders[fi];
      spinner.remove();

      const scroll = document.createElement("div");
      scroll.className = "diff-scroll";
      const host = document.createElement("div");
      host.className = "diffs-host";
      host.innerHTML = Array.isArray(file.prerenderedHTML)
        ? renderHTML(file.prerenderedHTML)
        : String(file.prerenderedHTML || "");
      scroll.append(host);
      wrapper.append(scroll);
    }
  }
  shellState.shell.dataset.renderState = "ready";
}

try {
  const [mod, ssrMod] = await Promise.all([
    import(moduleUrl),
    import(ssrModuleUrl),
  ]);
  const { parsePatchFiles, registerCustomTheme } = mod;
  const { preloadPatchFile, renderHTML, registerCustomTheme: registerCustomThemeSSR } = ssrMod;

  // Register rsms themes with both main and SSR modules
  // registerCustomTheme expects a loader that returns a Promise
  if (registerCustomTheme) {
    registerCustomTheme("rsms-dark", () => Promise.resolve(rsmsDarkTheme));
    registerCustomTheme("rsms-light", () => Promise.resolve(rsmsLightTheme));
  }
  if (registerCustomThemeSSR) {
    registerCustomThemeSSR("rsms-dark", () => Promise.resolve(rsmsDarkTheme));
    registerCustomThemeSSR("rsms-light", () => Promise.resolve(rsmsLightTheme));
  }

  const state = { ...defaults };

  applyLayoutState(state);

  for (const shell of document.querySelectorAll("[data-diff-shell]")) {
    try {
      const patch = decodeBase64Utf8(shell.dataset.diffPatch || "");
      const patchFiles = parsePatchFiles(patch);
      const mount = shell.querySelector("[data-diff-hosts]");

      if (!mount || patchFiles.every((entry) => (entry.files || []).length === 0)) {
        shell.dataset.renderState = "empty";
        continue;
      }

      shellStates.push({
        shell,
        mount,
        patch,
      });
    } catch (error) {
      shell.dataset.renderState = "error";
      const errMsg = error instanceof Error ? error.message : String(error);
      const errDiv = document.createElement("div");
      errDiv.className = "glimpse-error";
      errDiv.innerHTML = "Failed to render diff.<br><code>" +
        errMsg.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code>";
      shell.prepend(errDiv);
      console.error("Failed to render diff block.", error);
    }
  }

  for (const shellState of shellStates) {
    await renderShell(shellState, preloadPatchFile, renderHTML, state);
  }

  // Render changes blocks (expandable file diffs)
  // Uses FileDiff.render() for full interactivity (expand/collapse hunks).
  // FileDiff renders into a shadow DOM, so we inject the core CSS manually.
  const { FileDiff, preloadHighlighter, wrapCoreCSS, SVGSpriteSheet } = mod;
  const changesShells = document.querySelectorAll("[data-changes-shell]");
  if (FileDiff && changesShells.length > 0) {
    // Collect unique languages from filenames for syntax highlighting
    const langSet = new Set();
    for (const shell of changesShells) {
      for (const fileEl of shell.querySelectorAll(".changes-file")) {
        const name = fileEl.dataset.fileName || "";
        const ext = name.split(".").pop()?.toLowerCase();
        if (ext) langSet.add(ext === "ts" || ext === "tsx" ? "typescript" : ext === "js" || ext === "jsx" ? "javascript" : ext);
      }
    }

    // Preload highlighter with required themes and languages
    try {
      await preloadHighlighter({
        themes: ["rsms-dark", "rsms-light"],
        langs: [...langSet],
      });
    } catch (e) {
      console.warn("Failed to preload highlighter:", e);
    }

    // Get the core CSS to inject into shadow roots
    const coreCSS = wrapCoreCSS();

    for (const shell of changesShells) {
      for (const fileEl of shell.querySelectorAll(".changes-file")) {
        try {
          const filename = fileEl.dataset.fileName || "file";
          const oldEncoded = fileEl.dataset.oldContents;
          const newEncoded = fileEl.dataset.newContents;
          const focusStart = fileEl.dataset.focusStart;

          const oldContents = oldEncoded ? decodeBase64Utf8(oldEncoded) : "";
          const newContents = newEncoded ? decodeBase64Utf8(newEncoded) : "";

          const oldFile = { name: filename, contents: oldContents };
          const newFile = { name: filename, contents: newContents };

          const changesOptions = {
            ...createViewOptions(state),
            hunkSeparators: "line-info",
            disableFileHeader: true,
            unsafeCSS: changesUnsafeCss,
          };

          const mount = fileEl.querySelector(".changes-mount");
          if (!mount) continue;

          const host = document.createElement("div");
          host.className = "diffs-host";
          mount.replaceChildren(host);

          const instance = new FileDiff(changesOptions);
          instance.render({
            oldFile,
            newFile,
            fileContainer: host,
          });

          // Inject core CSS and SVG sprite sheet into shadow root
          if (host.shadowRoot) {
            if (coreCSS) {
              const styleEl = document.createElement("style");
              styleEl.textContent = coreCSS;
              host.shadowRoot.prepend(styleEl);
            }
            if (SVGSpriteSheet) {
              const spriteContainer = document.createElement("div");
              spriteContainer.innerHTML = SVGSpriteSheet;
              const spriteEl = spriteContainer.firstElementChild;
              if (spriteEl) host.shadowRoot.prepend(spriteEl);
            }

            // Preserve scroll position when hunks expand/collapse.
            // Capture height before click, then after DOM mutation + layout,
            // adjust scrollY if the host is above the viewport.
            const sr = host.shadowRoot;
            let heightBeforeClick = host.offsetHeight;

            sr.addEventListener("click", () => {
              heightBeforeClick = host.offsetHeight;
            }, { capture: true });

            const observer = new MutationObserver(() => {
              requestAnimationFrame(() => {
                const newHeight = host.offsetHeight;
                const delta = newHeight - heightBeforeClick;
                if (delta === 0) return;
                // Only adjust if the host starts above the viewport top,
                // meaning expanded content pushes things below it down.
                if (host.getBoundingClientRect().top < 0) {
                  window.scrollBy(0, delta);
                }
                heightBeforeClick = newHeight;
              });
            });
            observer.observe(sr, { childList: true, subtree: true });
          }

          fileEl.dataset.renderState = "ready";

          if (focusStart) {
            mount.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        } catch (error) {
          fileEl.dataset.renderState = "error";
          const errMsg = error instanceof Error ? error.message : String(error);
          const errDiv = document.createElement("div");
          errDiv.className = "glimpse-error";
          errDiv.innerHTML = "Failed to render file diff.<br><code>" +
            errMsg.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code>";
          fileEl.prepend(errDiv);
          console.error("Failed to render changes file block.", error);
        }
      }
    }
  }

  // Render plain code blocks with syntax highlighting
  const { preloadFile } = ssrMod;
  for (const shell of document.querySelectorAll("[data-code-shell]")) {
    try {
      const contents = decodeBase64Utf8(shell.dataset.codeContents || "");
      const filename = shell.dataset.codeFilename || "file.txt";

      const result = await preloadFile({
        file: { name: filename, contents },
        options: {
          overflow: "wrap",
          disableLineNumbers: false,
          disableFileHeader: true,
          theme: rsmsThemeOption,
          themeType: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          unsafeCSS: diffUnsafeCss,
        },
      });

      if (result && result.prerenderedHTML) {
        const wrapper = document.createElement("div");
        wrapper.className = "code-file-block";
        const scroll = document.createElement("div");
        scroll.className = "code-scroll";
        const host = document.createElement("div");
        host.className = "diffs-host";
        host.innerHTML = Array.isArray(result.prerenderedHTML)
          ? renderHTML(result.prerenderedHTML)
          : String(result.prerenderedHTML || "");
        scroll.append(host);
        wrapper.append(scroll);

        // Keep the label, replace the pre/code fallback
        const label = shell.querySelector(".code-label");
        const pre = shell.querySelector("pre.code-block");
        if (pre) pre.replaceWith(wrapper);
        shell.dataset.renderState = "ready";
      } else {
        shell.dataset.renderState = "ready";
      }
    } catch (error) {
      shell.dataset.renderState = "ready"; // fall back to plain pre/code
      console.error("Failed to render code block.", error);
    }
  }
} catch (error) {
  console.error("Failed to load @pierre/diffs.", error);
  const msg = error instanceof Error ? error.message : String(error);
  const allShells = [
    ...document.querySelectorAll("[data-diff-shell]"),
    ...document.querySelectorAll("[data-changes-shell] .changes-file"),
    ...document.querySelectorAll("[data-code-shell]"),
  ];
  for (const shell of allShells) {
    shell.dataset.renderState = "error";
    if (!shell.querySelector(".glimpse-error")) {
      const errDiv = document.createElement("div");
      errDiv.className = "glimpse-error";
      errDiv.innerHTML = "Failed to load diff renderer. Check your network connection.<br><code>" +
        msg.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code>";
      shell.prepend(errDiv);
    }
  }
}
</script>`;
}
function renderDocument({ bodyHtml, title, sourceLabel }) {
  const { baseCss, markdownCss, annotationsCss } = loadCssAssets();
  const annotationsScript = loadAnnotationsScript();
  const fontFaceCss = loadFontFaceCss();
  const diffBootScript = createDiffBootScript(DEFAULT_DIFFS_MODULE_URL, DEFAULT_DIFFS_SSR_MODULE_URL);
  const light = getLightTheme();
  const dark = getDarkTheme();
  const checkmarkSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.75 12.75L10 15.25L16.25 8.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --primary: ${light.primary};
        --secondary: ${light.secondary};
        --accent: ${light.accent};
        --text: ${light.text};
        --muted: ${light.textMuted};
        --bg: ${light.background};
        --panel: ${light.backgroundPanel};
        --element: ${light.backgroundElement};
        --border: ${light.border};
        --border-active: ${light.borderActive};
        --border-subtle: ${light.borderSubtle};
        --diff-add: ${light.diffAdded};
        --diff-remove: ${light.diffRemoved};
        --diff-context: ${light.diffContext};
        --diff-hunk: ${light.diffHunkHeader};
        --diff-add-bg: ${light.diffAddedBg};
        --diff-remove-bg: ${light.diffRemovedBg};
        --diff-context-bg: ${light.diffContextBg};
        --diff-line-number: ${light.diffLineNumber};
        --heading: ${light.markdownHeading};
        --link: ${light.markdownLink};
        --inline-code: ${light.markdownCode};
        --quote: ${light.markdownBlockQuote};
        --rule: ${light.markdownHorizontalRule};
        --selection-bg: ${light.selectionBg};
        --selection-text: ${light.selectionText};
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --primary: ${dark.primary};
          --secondary: ${dark.secondary};
          --accent: ${dark.accent};
          --text: ${dark.text};
          --muted: ${dark.textMuted};
          --bg: ${dark.background};
          --panel: ${dark.backgroundPanel};
          --element: ${dark.backgroundElement};
          --border: ${dark.border};
          --border-active: ${dark.borderActive};
          --border-subtle: ${dark.borderSubtle};
          --diff-add: ${dark.diffAdded};
          --diff-remove: ${dark.diffRemoved};
          --diff-context: ${dark.diffContext};
          --diff-hunk: ${dark.diffHunkHeader};
          --diff-add-bg: ${dark.diffAddedBg};
          --diff-remove-bg: ${dark.diffRemovedBg};
          --diff-context-bg: ${dark.diffContextBg};
          --diff-line-number: ${dark.diffLineNumber};
          --heading: ${dark.markdownHeading};
          --link: ${dark.markdownLink};
          --inline-code: ${dark.markdownCode};
          --quote: ${dark.markdownBlockQuote};
          --rule: ${dark.markdownHorizontalRule};
          --selection-bg: ${dark.selectionBg};
          --selection-text: ${dark.selectionText};
        }
      }

      ::selection {
        background: var(--selection-bg);
        color: var(--selection-text);
      }

${fontFaceCss}
${baseCss}
${markdownCss}
${annotationsCss}

      /* Loading indicator */
      .glimpse-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 20px;
        color: var(--muted);
        font-size: 13px;
        font-family: inherit;
      }
      .glimpse-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: glimpse-spin 0.8s linear infinite;
      }
      @keyframes glimpse-spin {
        to { transform: rotate(360deg); }
      }
      [data-render-state="ready"] > .glimpse-loading,
      [data-render-state="error"] > .glimpse-loading,
      [data-render-state="empty"] > .glimpse-loading {
        display: none;
      }

      /* Error banner */
      .glimpse-error {
        display: none;
        padding: 12px 16px;
        margin: 4px 0;
        border-radius: 6px;
        background: var(--diff-remove-bg);
        border: 1px solid var(--diff-remove);
        color: var(--diff-remove);
        font-size: 13px;
        font-family: inherit;
        line-height: 1.5;
      }
      .glimpse-error code {
        font-size: 12px;
        opacity: 0.85;
        word-break: break-all;
      }
      [data-render-state="error"] > .glimpse-error {
        display: block;
      }

      /* Hide mount content while loading */
      [data-render-state="loading"] > .diff-mount,
      [data-render-state="loading"] > .changes-mount {
        visibility: hidden;
        height: 0;
        overflow: hidden;
      }

      .done-button {
        position: fixed;
        top: 12px;
        right: 16px;
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px 6px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg);
        color: var(--text);
        font-family: inherit;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
      }
      .done-button:hover {
        background: var(--panel);
        border-color: var(--border-active);
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      }
      .done-button:active {
        background: var(--element);
      }
      .done-button svg {
        flex-shrink: 0;
      }
    </style>
  </head>
  <body data-diff-style="split">
    <button class="comment-trigger"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 18.25C15.866 18.25 19.25 16.1552 19.25 11.5C19.25 6.84483 15.866 4.75 12 4.75C8.13401 4.75 4.75 6.84483 4.75 11.5C4.75 13.2675 5.23783 14.6659 6.05464 15.7206C6.29358 16.0292 6.38851 16.4392 6.2231 16.7926C6.12235 17.0079 6.01633 17.2134 5.90792 17.4082C5.45369 18.2242 6.07951 19.4131 6.99526 19.2297C8.0113 19.0263 9.14752 18.722 10.0954 18.2738C10.2933 18.1803 10.5134 18.1439 10.7305 18.1714C11.145 18.224 11.5695 18.25 12 18.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9.75 12H14.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 9.75V14.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
    <div id="layout">
      <div id="content">
        <div class="review-shell">
          <main class="markdown-body">
            ${bodyHtml}
          </main>
          <footer class="review-footer">
            <p class="review-source">${escapeHtml(sourceLabel)}</p>
          </footer>
        </div>
      </div>
      <div id="comments-sidebar"></div>
    </div>
    <button class="done-button" title="Close window">${checkmarkSvg}<span class="done-label">Done</span></button>
${diffBootScript}
    <script>${annotationsScript}</script>
  </body>
</html>`;
}
function formatReviewOutput(doneData) {
  const anns = doneData?.annotations || [];
  if (anns.length === 0)
    return "Window closed. User marked done without review.";
  const lines = ["User review:", ""];
  for (const ann of anns) {
    const ctx = ann.context || {};
    let location = "";
    if (ctx.type === "diff" && ctx.file) {
      location = ctx.lineNumber ? ` (${ctx.file}:${ctx.lineNumber})` : ` (${ctx.file})`;
    } else if (ctx.blockTag) {
      location = ` (${ctx.blockTag})`;
    }
    const quote = (ann.selectedText || "").replace(/\n/g, `
> `);
    lines.push(`> ${quote}${location}`);
    lines.push("");
    lines.push(ann.comment);
    lines.push("");
  }
  return lines.join(`
`).trimEnd();
}
async function openWithGlimpse(html, title, sessionFile, outputFile) {
  const win = open(html, {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    title,
    openLinks: true
  });
  let doneData = null;
  win.on("message", (data) => {
    const line = JSON.stringify({ ...data, ts: Date.now() }) + `
`;
    appendFileSync(sessionFile, line, "utf8");
    if (data.action === "done")
      doneData = data;
  });
  const closedPromise = new Promise((resolvePromise) => {
    win.once("closed", resolvePromise);
  });
  const firstEvent = await Promise.race([
    closedPromise.then(() => "closed"),
    new Promise((resolvePromise, rejectPromise) => {
      win.once("ready", () => resolvePromise("ready"));
      win.once("error", rejectPromise);
    })
  ]);
  if (firstEvent === "closed") {
    const result2 = "Window closed. User marked done without review.";
    if (outputFile)
      writeFileSync(outputFile, result2, "utf8");
    else
      console.log(result2);
    process.exit(0);
  }
  await closedPromise;
  const result = formatReviewOutput(doneData);
  if (outputFile) {
    writeFileSync(outputFile, result, "utf8");
  } else {
    console.log(result);
  }
  process.exit(0);
}
function renderAndWrite(markdown, sourceLabel) {
  const { html: bodyHtml, headings } = renderMarkdown(markdown);
  const firstHeading = headings.find((heading) => heading.level === 1)?.text || null;
  const title = firstHeading || "Markdown Preview";
  const documentHtml = renderDocument({ bodyHtml, title, sourceLabel });
  const sessionId = randomBytes(6).toString("hex");
  const outPath = join(tmpdir(), `${slugify(title)}.html`);
  const sessionFile = join(tmpdir(), `glimpse-session-${sessionId}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, documentHtml, "utf8");
  writeFileSync(sessionFile, "", "utf8");
  return { documentHtml, title, outPath, sessionFile };
}
async function serveMode(args) {
  const [htmlPath, outputFile, title, sessionFile] = args;
  if (!htmlPath || !outputFile || !title || !sessionFile) {
    console.error("--__serve requires: <htmlPath> <outputFile> <title> <sessionFile>");
    process.exit(1);
  }
  const html = readFileSync(htmlPath, "utf8");
  await openWithGlimpse(html, title, sessionFile, outputFile);
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--__serve") {
    await serveMode(args.slice(1));
    return;
  }
  const { markdown: inlineMarkdown, readFromStdin, dryRun, background } = parseInput(args);
  let markdown = "";
  if (readFromStdin) {
    markdown = await readStdin();
  } else if (inlineMarkdown !== null) {
    markdown = inlineMarkdown.replace(/\\n/g, `
`).replace(/\\t/g, "\t");
  } else if (!process.stdin.isTTY) {
    markdown = await readStdin();
  } else {
    printUsage();
    process.exit(1);
  }
  if (!markdown.trim()) {
    console.error("No markdown content provided.");
    process.exit(1);
  }
  const { documentHtml, title, outPath, sessionFile } = renderAndWrite(markdown, "glimpse-changes");
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, htmlPath: outPath, title }));
    return;
  }
  if (background) {
    const sessionId = randomBytes(6).toString("hex");
    const outputFile = join(tmpdir(), `glimpse-review-${sessionId}.txt`);
    writeFileSync(outputFile, "__PENDING__", "utf8");
    const child = spawn(process.execPath, [process.argv[1], "--__serve", outPath, outputFile, title, sessionFile], { detached: true, stdio: "ignore" });
    child.unref();
    console.log(`Glimpse window opened. Read ${outputFile} for user feedback.`);
    process.exit(0);
  }
  await openWithGlimpse(documentHtml, title, sessionFile);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
