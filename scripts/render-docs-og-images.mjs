import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(root, "docs");
const outputRoot = join(docsRoot, "public", "og");
const config = JSON.parse(readFileSync(join(docsRoot, "docs.json"), "utf8"));
const logoDataUri = `data:image/svg+xml;base64,${readFileSync(
  join(docsRoot, "public", "logos", "logo-light.svg"),
).toString("base64")}`;
const pageGroups = buildPageGroupMap(config.navigation?.tabs ?? []);

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

rmSync(outputRoot, { recursive: true, force: true });

const pages = listMdxFiles(docsRoot);
for (const pagePath of pages) {
  const slug = relative(docsRoot, pagePath)
    .slice(0, -extname(pagePath).length)
    .replaceAll("\\", "/");
  const source = readFileSync(pagePath, "utf8");
  const { body, frontmatter } = parseFrontmatter(source, pagePath);
  const title = frontmatter.title ?? titleFromSlug(slug);
  const description =
    frontmatter.description ??
    extractDescription(body) ??
    config.description ??
    "";
  const group = pageGroups.get(slug) ?? titleFromSlug(slug.split("/")[0]);
  const imagePath = join(outputRoot, `${slug}.png`);

  mkdirSync(dirname(imagePath), { recursive: true });
  await sharp(Buffer.from(renderOgSvg({ description, group, title })))
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(imagePath);

  const publicImagePath = `https://libretto.sh/docs/og/${slug}.png`;
  const updatedSource = setOgImage(source, publicImagePath, pagePath);
  if (updatedSource !== source) {
    writeFileSync(pagePath, updatedSource);
  }
}

console.log(`Rendered ${pages.length} docs OG images.`);

function buildPageGroupMap(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    for (const group of tab.groups ?? []) {
      addPages(group.pages ?? [], group.group ?? tab.tab ?? "Docs", groups);
    }
  }
  return groups;
}

function addPages(pages, group, groups) {
  for (const page of pages) {
    if (typeof page === "string") {
      groups.set(page, group);
      continue;
    }
    if (page && typeof page === "object") {
      addPages(page.pages ?? [], page.group ?? group, groups);
    }
  }
}

function listMdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") {
          return [];
        }
        return listMdxFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

function parseFrontmatter(source, pagePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error(`Missing frontmatter in ${pagePath}`);
  }
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const valueMatch = line.match(
      /^\s*(?:"([^"]+)"|'([^']+)'|([^:]+)):\s*(.*?)\s*$/,
    );
    if (!valueMatch) continue;
    const key = (valueMatch[1] ?? valueMatch[2] ?? valueMatch[3]).trim();
    frontmatter[key] = unquote(valueMatch[4]);
  }
  return {
    body: source.slice(match[0].length),
    frontmatter,
  };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function extractDescription(body) {
  const blockquote = body.match(/(?:^|\n)>\s*([^\n]+)/);
  if (blockquote) return cleanMarkdown(blockquote[1]);

  let inFence = false;
  const paragraph = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const trimmed = line.trim();
    if (
      inFence ||
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("<") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      /^\d+\.\s/.test(trimmed) ||
      /^(import|export)\s/.test(trimmed)
    ) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.length > 0 ? cleanMarkdown(paragraph.join(" ")) : undefined;
}

function cleanMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function setOgImage(source, imagePath, pagePath) {
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    throw new Error(`Missing frontmatter in ${pagePath}`);
  }
  const line = `"og:image": "${imagePath}"`;
  const existingPattern = /^\s*(?:"og:image"|'og:image'|og:image):.*$/m;
  if (existingPattern.test(frontmatterMatch[1])) {
    return source.replace(existingPattern, line);
  }
  const updatedFrontmatter = `${frontmatterMatch[1].trimEnd()}\n${line}`;
  return source.replace(frontmatterMatch[1], updatedFrontmatter);
}

function titleFromSlug(value) {
  const title = value
    .split("/")
    .at(-1)
    .split("-")
    .filter(Boolean)
    .join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function renderOgSvg({ description, group, title }) {
  const titleLines = wrapText(title, 11.5, 2);
  const descriptionLines = wrapText(description, 25, 2);
  const titleY = 310;
  const titleLineHeight = 70;
  const descriptionY =
    titleY + titleLines.length * titleLineHeight + (titleLines.length > 1 ? 6 : 12);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.48" stop-color="#f2fff5"/>
      <stop offset="1" stop-color="#70df8c"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#background)"/>
  <image href="${logoDataUri}" x="58" y="64" width="48" height="48"/>
  <text x="60" y="286" fill="#12ce41" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="400">${escapeXml(group)}</text>
  <text x="58" y="${titleY + 52}" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="700">
    ${renderTextLines(titleLines, titleLineHeight)}
  </text>
  <text x="58" y="${descriptionY + 31}" fill="#4b5563" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="400">
    ${renderTextLines(descriptionLines, 42)}
  </text>
</svg>`;
}

function renderTextLines(lines, lineHeight) {
  return lines
    .map(
      (line, index) =>
        `<tspan x="58" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
}

function wrapText(value, maxUnits, maxLines) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const candidate = current ? `${current} ${words[index]}` : words[index];
    if (!current || textUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = words[index];
    if (lines.length === maxLines - 1) {
      const remaining = [current, ...words.slice(index + 1)].join(" ");
      lines.push(truncateToUnits(remaining, maxUnits));
      return lines;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function truncateToUnits(value, maxUnits) {
  if (textUnits(value) <= maxUnits) return value;
  let result = value;
  while (result && textUnits(`${result}…`) > maxUnits) {
    result = result.slice(0, -1).trimEnd();
  }
  return `${result}…`;
}

function textUnits(value) {
  let units = 0;
  for (const character of value) {
    if (character === " ") units += 0.3;
    else if ("ilI.,:;!'|".includes(character)) units += 0.28;
    else if ("mwMW@%&".includes(character)) units += 0.9;
    else if (/[A-Z0-9]/.test(character)) units += 0.65;
    else units += 0.55;
  }
  return units;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
