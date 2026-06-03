import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postsPath = join(root, "src", "blog", "posts.ts");
const outputRoot = join(root, "public", "blog");
const mainOgImage = readFileSync(join(root, "public", "og-image.png"));

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const CONTENT_X = 58;
const ASCIIHEDRON_REVEAL_X = 875;

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

function wrapText(text, maxLineLength) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 4);
}

function renderTextLines(lines) {
  return lines
    .map(
      (line, index) =>
        `<text x="${CONTENT_X}" y="${194 + index * 72}" fill="#f3d36a" font-family="Fraunces, Georgia, serif" font-size="64" font-weight="500" letter-spacing="0">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function renderOgSvg(post) {
  const titleLines = wrapText(post.title, 21);
  const mainOgDataUri = `data:image/png;base64,${mainOgImage.toString("base64")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <filter id="amber-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f0b400" flood-opacity="0.25"/>
      <feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#f0b400" flood-opacity="0.16"/>
    </filter>
    <filter id="wordmark-glow" x="-20%" y="-40%" width="140%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#f0b400" flood-opacity="0.4"/>
    </filter>
  </defs>
  <image href="${mainOgDataUri}" x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}"/>
  <rect x="0" y="0" width="${ASCIIHEDRON_REVEAL_X}" height="${OG_HEIGHT}" fill="#10100f"/>
  <rect x="0" y="${OG_HEIGHT - 4}" width="${OG_WIDTH}" height="4" fill="#1e1e1c"/>
  <g filter="url(#wordmark-glow)">
    <text x="${CONTENT_X}" y="88" fill="#f0b400" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="34" font-weight="900" letter-spacing="1.6">LIBRETTO</text>
  </g>
  <g filter="url(#amber-glow)">
  ${renderTextLines(titleLines)}
  </g>
  <text x="${CONTENT_X}" y="566" fill="#8a8472" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="24">libretto.sh/blog/${escapeXml(post.slug)}</text>
</svg>`;
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
  await sharp(Buffer.from(renderOgSvg(post)))
    .png()
    .toFile(join(outputDir, "og-image.png"));
}

console.log("Rendered blog OG images.");
