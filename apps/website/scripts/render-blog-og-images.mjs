import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postsPath = join(root, "src", "blog", "posts.ts");
const brandPath = join(root, "src", "brand.tsx");
const outputRoot = join(root, "public", "blog");
const brandSource = readFileSync(brandPath, "utf8");
const paperAsciihedronPath = join(root, "public", "og", "paper-asciihedron.png");
const paperLogoImage = readFileSync(join(root, "public", "og", "paper-logo.png"));
const serifFontPath = join(root, "public", "fonts", "Fraunces-Regular.ttf");
const monoFontPath = join(root, "public", "fonts", "CommitMono-VF.woff2");

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const PAPER_UNIT = 4;
const PAPER_ASCIIHEDRON_SIZE = 345 * PAPER_UNIT;
const PAPER_ASCIIHEDRON_X = 112.25 * PAPER_UNIT;
const PAPER_ASCIIHEDRON_Y = -91 * PAPER_UNIT;
const LOGO_SIZE = 13.25 * PAPER_UNIT;
const LOGO_X = 14 * PAPER_UNIT;
const LOGO_Y = 13.5 * PAPER_UNIT;
const WORDMARK_X = 28.75 * PAPER_UNIT;
const WORDMARK_Y = 16.75 * PAPER_UNIT;
const TITLE_X = 14 * PAPER_UNIT;
const TITLE_Y = 38 * PAPER_UNIT;
const TITLE_MAX_WIDTH = 166 * PAPER_UNIT;
const URL_X = 14 * PAPER_UNIT;
const URL_Y = 130 * PAPER_UNIT;
const SITE_URL = "https://libretto.sh";

const brandName = readBrandStringConst("LIBRETTO_NAME");

function readPosts() {
  const source = readFileSync(postsPath, "utf8");
  const blocks = source.matchAll(/createBlogPost\(\{([\s\S]*?)\n  \}\),/g);

  return [...blocks].map((match) => {
    const block = match[1];
    const slug = block.match(/slug:\s*"([^"]+)"/)?.[1];
    const title = block.match(/title:\s*"([^"]+)"/)?.[1];

    if (!slug || !title) {
      throw new Error("Unable to parse blog post slug/title for OG image generation.");
    }

    return { slug, title };
  });
}

async function renderOgImage(post) {
  const asciihedronLayer = getVisibleLayer({
    height: PAPER_ASCIIHEDRON_SIZE,
    left: PAPER_ASCIIHEDRON_X,
    top: PAPER_ASCIIHEDRON_Y,
    width: PAPER_ASCIIHEDRON_SIZE,
  });
  const asciihedron = await sharp(paperAsciihedronPath)
    .resize(
      Math.round(PAPER_ASCIIHEDRON_SIZE),
      Math.round(PAPER_ASCIIHEDRON_SIZE),
    )
    .extract(asciihedronLayer.extract)
    .tint("#6d6d6d")
    .png()
    .toBuffer();
  const logo = await sharp(paperLogoImage)
    .resize(LOGO_SIZE, LOGO_SIZE)
    .png()
    .toBuffer();
  const wordmark = await renderTextLayer({
    color: "#EBEEEB",
    font: "Fraunces",
    fontfile: serifFontPath,
    fontSize: 48,
    text: brandName,
  });
  const title = await renderTextLayer({
    color: "#EBEEEB",
    font: "Fraunces",
    fontfile: serifFontPath,
    fontSize: 72,
    text: post.title,
    width: TITLE_MAX_WIDTH,
  });
  const url = await renderTextLayer({
    color: "#EBEEEB",
    font: "Commit Mono",
    fontfile: monoFontPath,
    fontSize: 24,
    text: SITE_URL,
  });

  return sharp({
    create: {
      background: "#111111",
      channels: 4,
      height: OG_HEIGHT,
      width: OG_WIDTH,
    },
  })
    .composite([
      {
        input: asciihedron,
        left: asciihedronLayer.left,
        top: asciihedronLayer.top,
      },
      { input: logo, left: Math.round(LOGO_X), top: Math.round(LOGO_Y) },
      { input: wordmark, left: Math.round(WORDMARK_X), top: Math.round(WORDMARK_Y) },
      { input: title, left: Math.round(TITLE_X), top: Math.round(TITLE_Y) },
      { input: url, left: Math.round(URL_X), top: Math.round(URL_Y) },
    ])
    .png()
    .toBuffer();
}

function getVisibleLayer({ height, left, top, width }) {
  const visibleLeft = Math.max(0, Math.round(left));
  const visibleTop = Math.max(0, Math.round(top));
  const extractLeft = Math.max(0, Math.round(-left));
  const extractTop = Math.max(0, Math.round(-top));
  const visibleWidth = Math.min(
    Math.round(width) - extractLeft,
    OG_WIDTH - visibleLeft,
  );
  const visibleHeight = Math.min(
    Math.round(height) - extractTop,
    OG_HEIGHT - visibleTop,
  );

  return {
    extract: {
      height: visibleHeight,
      left: extractLeft,
      top: extractTop,
      width: visibleWidth,
    },
    left: visibleLeft,
    top: visibleTop,
  };
}

async function renderTextLayer({
  color,
  font,
  fontfile,
  fontSize,
  text,
  width,
}) {
  return sharp({
    text: {
      dpi: 72,
      font,
      fontfile,
      rgba: true,
      text: `<span foreground="${color}" size="${fontSize * 1024}">${escapeXml(text)}</span>`,
      width,
    },
  })
    .png()
    .toBuffer();
}

function readBrandStringConst(name) {
  const match = brandSource.match(
    new RegExp(`export const ${name} =\\s*"([^"]+)";`, "m"),
  );
  if (!match) {
    throw new Error(`Unable to read ${name} from ${brandPath}.`);
  }
  return match[1];
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

for (const post of readPosts()) {
  const outputDir = join(outputRoot, post.slug);
  mkdirSync(outputDir, { recursive: true });
  await sharp(await renderOgImage(post)).toFile(join(outputDir, "og-image.png"));
}

console.log("Rendered blog OG images.");
