#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { open } from "glimpseui";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = dirname(scriptDir);
const assetsDir = join(skillDir, "assets");
const DEFAULT_DIFFS_MODULE_URL = "https://esm.sh/@pierre/diffs@1.1.1?bundle";
const DEFAULT_DIFFS_SSR_MODULE_URL = "https://esm.sh/@pierre/diffs@1.1.1/ssr?bundle";
const DEFAULT_WIDTH = 1240;
const DEFAULT_HEIGHT = 920;

function printUsage() {
  console.log(`render-md.mjs [markdown]

Render Markdown into a Critique-styled HTML page, open it in Glimpse, and use
Diffs.com for fenced diff blocks.

Input:
  - Pass a single inline Markdown argument, or
  - pipe Markdown over stdin.
`);
}

function parseInput(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    printUsage();
    process.exit(0);
  }

  if (argv.length > 1) {
    throw new Error("Expected a single inline Markdown argument or stdin.");
  }

  return argv[0] ?? null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

function encodeBase64Utf8(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function formatUnifiedRange(start, count) {
  if (count === 1) return `${start}`;
  if (count === 0) return `${start},0`;
  return `${start},${count}`;
}

function isValidUnifiedHunkHeader(line) {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line);
}

function isMalformedHunkHeader(line) {
  return /^@@(?:\s.*)?$/.test(line) && !isValidUnifiedHunkHeader(line);
}

function normalizePatchForDiffs(patch) {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
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
      if (next.startsWith("diff --git ") || next.startsWith("@@")) break;
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

    normalized.push(
      `@@ -${formatUnifiedRange(oldStart, oldCount)} +${formatUnifiedRange(newStart, newCount)} @@`,
    );
    normalized.push(...hunkLines);
    oldStart += oldCount;
    newStart += newCount;
  }

  return normalized.join("\n");
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

  return codeSpans.reduce(
    (result, html, index) => result.replace(`__CODE_${index}__`, html),
    escaped,
  );
}

function renderDiffBlock(code) {
  const patchBase64 = encodeBase64Utf8(normalizePatchForDiffs(code));

  return `<div class="diff-shell" data-diff-shell data-diff-patch="${patchBase64}">
    <div class="diff-mount" data-diff-hosts></div>
  </div>`;
}

function renderPlainCodeBlock(code, language) {
  const lang = (language || "").trim().toLowerCase();
  return `<div class="code-shell"><div class="code-label">${escapeHtml(lang || "text")}</div><pre class="code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre></div>`;
}

function renderCodeBlock(code, language) {
  const lang = (language || "").trim().toLowerCase();
  const lines = code.replace(/\n$/, "").split("\n");
  const isDiff = lang === "diff" || lines.some((line) => /^(@@|diff --git |[+-])/.test(line));

  if (isDiff) {
    return renderDiffBlock(code);
  }

  return renderPlainCodeBlock(code, language);
}

function parseFenceOpen(trimmed) {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (!match) return null;

  return {
    markerChar: match[1][0],
    markerLength: match[1].length,
    language: match[2].trim(),
  };
}

function isFenceClose(trimmed, opener) {
  const close = new RegExp(`^${opener.markerChar}{${opener.markerLength},}\\s*$`);
  return close.test(trimmed);
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const headings = [];
  let index = 0;

  const isBlockBoundary = (line) =>
    line.trim() === "" ||
    /^#{1,6}\s+/.test(line) ||
    /^(`{3,}|~{3,})/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^([-*_])\1{2,}\s*$/.test(line);

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
      if (level <= 3) headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${parseInline(text)}</h${level}>`);
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
      if (index < lines.length) index += 1;
      html.push(renderCodeBlock(buffer.join("\n"), fenceOpen.language));
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
      html.push(`<blockquote>${quoteLines.map((quoteLine) => parseInline(quoteLine)).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${parseInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${parseInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockBoundary(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${parseInline(paragraph.join(" "))}</p>`);
  }

  return { html: html.join("\n"), headings };
}

function getEmbeddedCritiqueTheme() {
  return {
    primary: "#0550ae",
    secondary: "#8250df",
    accent: "#1b7c83",
    text: "#24292f",
    textMuted: "#57606a",
    background: "#ffffff",
    backgroundPanel: "#f6f8fa",
    backgroundElement: "#f0f3f6",
    border: "#d0d7de",
    borderActive: "#0550ae",
    borderSubtle: "#d8dee4",
    diffAdded: "#116329",
    diffRemoved: "#cf222e",
    diffContext: "#57606a",
    diffHunkHeader: "#8250df",
    diffAddedBg: "#f0fff4",
    diffRemovedBg: "#fff7f6",
    diffContextBg: "#f6f8fa",
    diffLineNumber: "#afb8c1",
    markdownHeading: "#0550ae",
    markdownLink: "#0a3069",
    markdownCode: "#0550ae",
    markdownBlockQuote: "#116329",
    markdownHorizontalRule: "#d0d7de",
  };
}

function loadCssAssets() {
  return {
    baseCss: readFileSync(join(assetsDir, "critique-base.css"), "utf8"),
    markdownCss: readFileSync(join(assetsDir, "critique-markdown.css"), "utf8"),
  };
}

function loadFontFaceCss() {
  const fontPath = join(assetsDir, "jetbrains-mono-nerd.woff2");
  if (!existsSync(fontPath)) return "";
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
  diffIndicators: "classic",
  lineDiffType: "word-alt",
  hunkSeparators: "line-info",
  showLineNumbers: true,
  showBackground: false,
  showFileHeader: false,
  unifiedWidth: 90,
  splitPaneWidth: 90,
  viewportCap: 60,
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

[data-separator],
[data-separator-wrapper],
[data-separator-content],
[data-unmodified-lines] {
  display: none !important;
}
\`;

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function applyLayoutState(state) {
  document.body.dataset.diffStyle = state.diffStyle;
  document.documentElement.style.setProperty("--diff-unified-width", \`\${state.unifiedWidth}ch\`);
  document.documentElement.style.setProperty("--diff-split-pane-width", \`\${state.splitPaneWidth}ch\`);
  document.documentElement.style.setProperty("--diff-shell-vw-cap", \`\${state.viewportCap}vw\`);
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
    themeType: "light",
    unsafeCSS: diffUnsafeCss,
  };
}

async function renderShell(shellState, preloadPatchFile, renderHTML, state) {
  shellState.mount.replaceChildren();
  shellState.shell.dataset.renderState = "pending";

  const files = await preloadPatchFile({
    patch: shellState.patch,
    options: createViewOptions(state),
  });
  if (files.length === 0) {
    shellState.shell.dataset.renderState = "empty";
    return;
  }

  for (const file of files) {
    const wrapper = document.createElement("div");
    wrapper.className = "diff-file-block";

    const headerRow = document.createElement("div");
    headerRow.className = "diff-header-row";

    const pathLabel = document.createElement("div");
    pathLabel.className = "diff-path-label";
    pathLabel.textContent = file.fileDiff?.name || file.fileDiff?.prevName || "file";
    headerRow.append(pathLabel);
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
  shellState.shell.dataset.renderState = "ready";
}

try {
  const [mod, ssrMod] = await Promise.all([
    import(moduleUrl),
    import(ssrModuleUrl),
  ]);
  const { parsePatchFiles } = mod;
  const { preloadPatchFile, renderHTML } = ssrMod;
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
      console.error("Failed to render diff block.", error);
    }
  }

  for (const shellState of shellStates) {
    await renderShell(shellState, preloadPatchFile, renderHTML, state);
  }
} catch (error) {
  console.error("Failed to load @pierre/diffs.", error);
}
</script>`;
}

function renderDocument({ bodyHtml, title, sourceLabel }) {
  const { baseCss, markdownCss } = loadCssAssets();
  const fontFaceCss = loadFontFaceCss();
  const diffBootScript = createDiffBootScript(
    DEFAULT_DIFFS_MODULE_URL,
    DEFAULT_DIFFS_SSR_MODULE_URL,
  );
  const theme = getEmbeddedCritiqueTheme();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --primary: ${theme.primary};
        --secondary: ${theme.secondary};
        --accent: ${theme.accent};
        --text: ${theme.text};
        --muted: ${theme.textMuted};
        --bg: ${theme.background};
        --panel: ${theme.backgroundPanel};
        --element: ${theme.backgroundElement};
        --border: ${theme.border};
        --border-active: ${theme.borderActive};
        --border-subtle: ${theme.borderSubtle};
        --diff-add: ${theme.diffAdded};
        --diff-remove: ${theme.diffRemoved};
        --diff-context: ${theme.diffContext};
        --diff-hunk: ${theme.diffHunkHeader};
        --diff-add-bg: ${theme.diffAddedBg};
        --diff-remove-bg: ${theme.diffRemovedBg};
        --diff-context-bg: ${theme.diffContextBg};
        --diff-line-number: ${theme.diffLineNumber};
        --heading: ${theme.markdownHeading};
        --link: ${theme.markdownLink};
        --inline-code: ${theme.markdownCode};
        --quote: ${theme.markdownBlockQuote};
        --rule: ${theme.markdownHorizontalRule};
      }

${fontFaceCss}
${baseCss}
${markdownCss}
    </style>
  </head>
  <body data-diff-style="split">
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
${diffBootScript}
  </body>
</html>`;
}

async function openWithGlimpse(html, title) {
  const win = open(html, {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    title,
    openLinks: true,
  });
  const closedPromise = new Promise((resolvePromise) => {
    win.once("closed", resolvePromise);
  });

  const firstEvent = await Promise.race([
    closedPromise.then(() => "closed"),
    new Promise((resolvePromise, rejectPromise) => {
      win.once("ready", () => resolvePromise("ready"));
      win.once("error", rejectPromise);
    }),
  ]);

  if (firstEvent === "closed") {
    process.exit(0);
  }

  await closedPromise;
  process.exit(0);
}

async function main() {
  const inlineMarkdown = parseInput(process.argv.slice(2));

  let markdown = "";
  let sourceLabel = "stdin";

  if (inlineMarkdown !== null) {
    markdown = inlineMarkdown;
    sourceLabel = "inline argument";
  } else if (!process.stdin.isTTY) {
    markdown = await readStdin();
  } else {
    printUsage();
    process.exit(1);
  }

  const { html: bodyHtml, headings } = renderMarkdown(markdown);
  const firstHeading = headings.find((heading) => heading.level === 1)?.text || null;
  const title = firstHeading || "Markdown Preview";
  const documentHtml = renderDocument({
    bodyHtml,
    title,
    sourceLabel,
  });
  const outPath = join(tmpdir(), `${slugify(title)}.html`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, documentHtml, "utf8");

  console.log(JSON.stringify({ htmlPath: outPath, title, opened: true }));
  await openWithGlimpse(documentHtml, title);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
