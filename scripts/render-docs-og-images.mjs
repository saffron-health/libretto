import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(root, "docs");
const outputRoot = join(docsRoot, "public", "og");
const config = JSON.parse(readFileSync(join(docsRoot, "docs.json"), "utf8"));
const logoDataUri = `data:image/svg+xml;base64,${readFileSync(
  join(docsRoot, "public", "logos", "logo-light.svg"),
).toString("base64")}`;
const serifFontData = readFileSync(
  join(root, "apps", "website", "public", "fonts", "Fraunces-Regular.ttf"),
);
const sansFontData = readFileSync(
  fileURLToPath(
    import.meta.resolve(
      "@fontsource/inter/files/inter-latin-400-normal.woff",
    ),
  ),
);
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
  await sharp(Buffer.from(await renderOgSvg({ description, group, title })))
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
    .replaceAll("<", " ")
    .replaceAll(">", " ")
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

async function renderOgSvg({ description, group, title }) {
  return satori(
    element(
      "div",
      {
        style: {
          alignItems: "flex-start",
          backgroundImage:
            "linear-gradient(135deg, #090a09 0%, #0b140e 52%, #087326 100%)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: 58,
          width: "100%",
        },
      },
      element("img", {
        height: 48,
        src: logoDataUri,
        style: { height: 48, width: 48 },
        width: 48,
      }),
      element(
        "div",
        {
          style: {
            alignItems: "flex-start",
            display: "flex",
            flexDirection: "column",
            width: 720,
          },
        },
        element(
          "div",
          {
            style: {
              color: "#12ce41",
              fontFamily: "Inter",
              fontSize: 27,
              lineHeight: 1.2,
              marginBottom: 14,
            },
          },
          group,
        ),
        element(
          "div",
          {
            style: {
              color: "#f3f4f6",
              fontFamily: "Libretto Serif",
              fontSize: 64,
              fontWeight: 400,
              lineClamp: 2,
              lineHeight: 1.1,
              textOverflow: "ellipsis",
              width: "100%",
            },
          },
          title,
        ),
        element(
          "div",
          {
            style: {
              color: "#b7bbb8",
              fontFamily: "Inter",
              fontSize: 28,
              lineClamp: 2,
              lineHeight: 1.5,
              marginTop: 22,
              textOverflow: "ellipsis",
              width: "100%",
            },
          },
          description,
        ),
      ),
    ),
    {
      fonts: [
        {
          data: serifFontData,
          name: "Libretto Serif",
          style: "normal",
          weight: 400,
        },
        {
          data: sansFontData,
          name: "Inter",
          style: "normal",
          weight: 400,
        },
      ],
      height: OG_HEIGHT,
      width: OG_WIDTH,
    },
  );
}

function element(type, props = {}, ...children) {
  return {
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children,
    },
    type,
  };
}
