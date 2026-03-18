#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const assetsDir = resolve(skillDir, "assets");
const requireFromCwd = createRequire(join(process.cwd(), "package.json"));
const DEFAULT_DIFFS_MODULE_URL = "https://esm.sh/@pierre/diffs@1.1.1?bundle";
const DIFF_STYLES = new Set(["split", "unified"]);

function printUsage() {
  console.log(`render-md.mjs [file|-] [options]

Render a Markdown document into a Critique-styled HTML page and optionally
open it with Glimpse.

Options:
  --title <title>            Override the page title
  --out <path>               Write HTML to this path
  --no-open                  Generate HTML only
  --diffs-module-url <url>   Browser module URL for @pierre/diffs
  --diff-style <style>       Render diffs as split or unified (default: split)
  --glimpse-module <path>    Absolute or relative path to glimpse.mjs
  --glimpse-repo <path>      Path to a Glimpse checkout or install root
  --critique-repo <path>     Path to a Critique checkout for theme tokens
  --width <px>               Glimpse window width (default: 1240)
  --height <px>              Glimpse window height (default: 920)
  --help                     Show this message

Input:
  - Pass a file path as the first argument, or
  - pipe Markdown over stdin.
`);
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    title: null,
    outPath: null,
    noOpen: false,
    diffsModuleUrl: DEFAULT_DIFFS_MODULE_URL,
    diffStyle: "split",
    glimpseModule: null,
    glimpseRepo: process.env.GLIMPSE_REPO || null,
    critiqueRepo: process.env.CRITIQUE_REPO || null,
    width: 1240,
    height: 920,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--title") {
      options.title = argv[++index] ?? null;
      continue;
    }
    if (arg === "--out") {
      options.outPath = argv[++index] ?? null;
      continue;
    }
    if (arg === "--no-open") {
      options.noOpen = true;
      continue;
    }
    if (arg === "--diffs-module-url") {
      options.diffsModuleUrl = argv[++index] ?? options.diffsModuleUrl;
      continue;
    }
    if (arg === "--diff-style") {
      const diffStyle = argv[++index] ?? options.diffStyle;
      if (!DIFF_STYLES.has(diffStyle)) {
        throw new Error(`Invalid diff style: ${diffStyle}`);
      }
      options.diffStyle = diffStyle;
      continue;
    }
    if (arg === "--glimpse-module") {
      options.glimpseModule = argv[++index] ?? null;
      continue;
    }
    if (arg === "--glimpse-repo") {
      options.glimpseRepo = argv[++index] ?? null;
      continue;
    }
    if (arg === "--critique-repo") {
      options.critiqueRepo = argv[++index] ?? null;
      continue;
    }
    if (arg === "--width") {
      options.width = Number(argv[++index] ?? options.width);
      continue;
    }
    if (arg === "--height") {
      options.height = Number(argv[++index] ?? options.height);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.inputPath) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    options.inputPath = arg;
  }

  return options;
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
  const patchBase64 = encodeBase64Utf8(code);

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

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const headings = [];
  let index = 0;

  const isBlockBoundary = (line) =>
    line.trim() === "" ||
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
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

    const fenceMatch = /^```([^`]*)$/.exec(trimmed);
    if (fenceMatch) {
      const language = fenceMatch[1].trim();
      const buffer = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(renderCodeBlock(buffer.join("\n"), language));
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

function resolveThemeValue(value, defs) {
  if (typeof value === "string") {
    if (value.startsWith("#")) return value;
    return defs[value] || value;
  }
  if (value && typeof value === "object") {
    return resolveThemeValue(value.light, defs);
  }
  return value;
}

function loadCritiqueTheme(repoPath) {
  if (!repoPath) return getEmbeddedCritiqueTheme();

  const themePath = resolve(repoPath, "cli", "src", "themes", "github.json");
  if (!existsSync(themePath)) return getEmbeddedCritiqueTheme();

  const json = JSON.parse(readFileSync(themePath, "utf8"));
  const defs = json.defs || {};
  const theme = json.theme || {};

  return {
    primary: resolveThemeValue(theme.primary, defs),
    secondary: resolveThemeValue(theme.secondary, defs),
    accent: resolveThemeValue(theme.accent, defs),
    text: resolveThemeValue(theme.text, defs),
    textMuted: resolveThemeValue(theme.textMuted, defs),
    background: resolveThemeValue(theme.background, defs),
    backgroundPanel: resolveThemeValue(theme.backgroundPanel, defs),
    backgroundElement: resolveThemeValue(theme.backgroundElement, defs),
    border: resolveThemeValue(theme.border, defs),
    borderActive: resolveThemeValue(theme.borderActive, defs),
    borderSubtle: resolveThemeValue(theme.borderSubtle, defs),
    diffAdded: resolveThemeValue(theme.diffAdded, defs),
    diffRemoved: resolveThemeValue(theme.diffRemoved, defs),
    diffContext: resolveThemeValue(theme.diffContext, defs),
    diffHunkHeader: resolveThemeValue(theme.diffHunkHeader, defs),
    diffAddedBg: resolveThemeValue(theme.diffAddedBg, defs),
    diffRemovedBg: resolveThemeValue(theme.diffRemovedBg, defs),
    diffContextBg: resolveThemeValue(theme.diffContextBg, defs),
    diffLineNumber: resolveThemeValue(theme.diffLineNumber, defs),
    markdownHeading: resolveThemeValue(theme.markdownHeading, defs),
    markdownLink: resolveThemeValue(theme.markdownLink, defs),
    markdownCode: resolveThemeValue(theme.markdownCode, defs),
    markdownBlockQuote: resolveThemeValue(theme.markdownBlockQuote, defs),
    markdownHorizontalRule: resolveThemeValue(theme.markdownHorizontalRule, defs),
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

function createDiffBootScript(moduleUrl, diffStyle) {
  return `<script type="module">
const moduleUrl = ${JSON.stringify(moduleUrl)};
const defaults = {
  diffStyle: "unified",
  overflow: "wrap",
  diffIndicators: "none",
  lineDiffType: "word-alt",
  hunkSeparators: "line-info",
  showLineNumbers: true,
  showBackground: false,
  showFileHeader: false,
  unifiedWidth: 70,
  splitPaneWidth: 70,
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

[data-line],
[data-no-newline] {
  padding-left: 0 !important;
  padding-right: 0 !important;
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

function renderShell(shellState, FileDiff, DIFFS_TAG_NAME, state) {
  shellState.views.forEach((view) => {
    try {
      view.cleanUp(true);
    } catch {}
  });
  shellState.views = [];
  shellState.mount.replaceChildren();

  if (shellState.fileDiffs.length === 0) {
    shellState.shell.dataset.renderState = "empty";
    return;
  }

  const viewOptions = createViewOptions(state);
  for (const fileDiff of shellState.fileDiffs) {
    const wrapper = document.createElement("div");
    wrapper.className = "diff-file-block";

    if (!state.showFileHeader) {
      const pathLabel = document.createElement("div");
      pathLabel.className = "diff-path-label";
      pathLabel.textContent = fileDiff.name || fileDiff.prevName || "file";
      wrapper.append(pathLabel);
    }

    const scroll = document.createElement("div");
    scroll.className = "diff-scroll";

    const host = document.createElement(DIFFS_TAG_NAME);
    host.className = "diffs-host";
    scroll.append(host);
    wrapper.append(scroll);
    shellState.mount.append(wrapper);

    const view = new FileDiff(viewOptions);
    view.render({ fileDiff, fileContainer: host });
    shellState.views.push(view);
  }

  shellState.shell.dataset.renderState = "ready";
}

try {
  const mod = await import(moduleUrl);
  const { DIFFS_TAG_NAME, FileDiff, parsePatchFiles } = mod;
  const state = { ...defaults };

  applyLayoutState(state);

  for (const shell of document.querySelectorAll("[data-diff-shell]")) {
    try {
      const patch = decodeBase64Utf8(shell.dataset.diffPatch || "");
      const patchFiles = parsePatchFiles(patch);
      const fileDiffs = patchFiles.flatMap((entry) => entry.files || []);
      const mount = shell.querySelector("[data-diff-hosts]");

      if (!mount || fileDiffs.length === 0) {
        shell.dataset.renderState = "empty";
        continue;
      }

      shellStates.push({
        shell,
        mount,
        fileDiffs,
        views: [],
      });
    } catch (error) {
      shell.dataset.renderState = "error";
      console.error("Failed to render diff block.", error);
    }
  }

  for (const shellState of shellStates) {
    renderShell(shellState, FileDiff, DIFFS_TAG_NAME, state);
  }
} catch (error) {
  console.error("Failed to load @pierre/diffs.", error);
}
</script>`;
}

function renderDocument({ bodyHtml, title, sourceLabel, theme, diffsModuleUrl, diffStyle }) {
  const { baseCss, markdownCss } = loadCssAssets();
  const fontFaceCss = loadFontFaceCss();
  const diffBootScript = createDiffBootScript(diffsModuleUrl, diffStyle);

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
  <body data-diff-style="${escapeHtml(diffStyle)}">
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

function resolveGlimpseModule(options) {
  if (options.glimpseModule) {
    return resolve(options.glimpseModule);
  }
  if (options.glimpseRepo) {
    return resolve(options.glimpseRepo, "src", "glimpse.mjs");
  }
  try {
    return requireFromCwd.resolve("glimpseui");
  } catch {
    return null;
  }
}

async function openWithGlimpse(options, html, title) {
  const modulePath = resolveGlimpseModule(options);
  if (!modulePath) {
    throw new Error("Could not resolve Glimpse. Pass --glimpse-module or --glimpse-repo.");
  }

  const { open } = await import(pathToFileURL(modulePath).href);
  const win = open(html, {
    width: options.width,
    height: options.height,
    title,
    openLinks: true,
  });

  await new Promise((resolvePromise, rejectPromise) => {
    win.once("ready", resolvePromise);
    win.once("error", rejectPromise);
    win.once("closed", resolvePromise);
  });

  win.once("closed", () => process.exit(0));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let markdown = "";
  let sourceLabel = "stdin";
  if (options.inputPath && options.inputPath !== "-") {
    const inputPath = resolve(options.inputPath);
    markdown = readFileSync(inputPath, "utf8");
    sourceLabel = inputPath;
  } else if (!process.stdin.isTTY) {
    markdown = await readStdin();
  } else {
    printUsage();
    process.exit(1);
  }

  const { html: bodyHtml, headings } = renderMarkdown(markdown);
  const firstHeading = headings.find((heading) => heading.level === 1)?.text || null;
  const defaultTitle = firstHeading
    || (options.inputPath && options.inputPath !== "-" ? basename(options.inputPath, extname(options.inputPath)) : "Markdown Preview");
  const title = options.title || defaultTitle;
  const theme = loadCritiqueTheme(options.critiqueRepo);
  const documentHtml = renderDocument({
    bodyHtml,
    title,
    sourceLabel,
    theme,
    diffsModuleUrl: options.diffsModuleUrl,
    diffStyle: options.diffStyle,
  });
  const outPath = options.outPath
    ? resolve(options.outPath)
    : join(tmpdir(), `${slugify(title)}.html`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, documentHtml, "utf8");

  console.log(JSON.stringify({ htmlPath: outPath, title, opened: !options.noOpen }));

  if (!options.noOpen) {
    await openWithGlimpse(options, documentHtml, title);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
