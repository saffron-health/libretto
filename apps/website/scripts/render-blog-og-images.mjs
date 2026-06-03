import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postsPath = join(root, "src", "blog", "posts.ts");
const outputRoot = join(root, "public", "blog");
const logoSvg = readFileSync(join(root, "public", "logos", "logo-dark.svg"), "utf8");

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

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

  return lines.slice(0, 5);
}

function renderTextLines(lines) {
  return lines
    .map(
      (line, index) =>
        `<text x="58" y="${196 + index * 70}" fill="#f0cf5a" stroke="#5a4300" stroke-width="0.8" font-family="Fraunces, Georgia, serif" font-size="62" font-weight="500" letter-spacing="0">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function renderAsciihedron() {
  const rows = [];
  const chars = " .:-=+*#%0@";
  const centerX = 910;
  const centerY = 310;
  const radiusX = 390;
  const radiusY = 360;
  const cellWidth = 9;
  const cellHeight = 10;

  for (let y = 0; y < OG_HEIGHT; y += cellHeight) {
    let line = "";
    for (let x = 520; x < OG_WIDTH + 80; x += cellWidth) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 1) {
        line += " ";
        continue;
      }

      const ridge = Math.sin((dx * 7.5 + dy * 3.5) * Math.PI) * 0.18;
      const light = Math.max(0, 1 - distance + ridge + (x > centerX ? 0.16 : 0));
      const index = Math.min(chars.length - 1, Math.max(0, Math.floor(light * chars.length)));
      line += chars[index];
    }
    rows.push(
      `<text x="520" y="${y}" fill="#d8d8d8" opacity="0.24" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12" letter-spacing="1">${escapeXml(line)}</text>`,
    );
  }

  return rows.join("\n");
}

function renderOgSvg(post) {
  const titleLines = wrapText(post.title, 24);
  const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <filter id="amber-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#f0b400" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="0" stdDeviation="9" flood-color="#f0b400" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#10100f"/>
  ${renderAsciihedron()}
  <rect x="0" y="0" width="780" height="${OG_HEIGHT}" fill="#10100f" opacity="0.94"/>
  <rect x="0" y="${OG_HEIGHT - 4}" width="${OG_WIDTH}" height="4" fill="#1e1e1c"/>
  <g filter="url(#amber-glow)">
    <image href="${logoDataUri}" x="48" y="46" width="54" height="54"/>
    <text x="122" y="83" fill="#f0b400" stroke="#775700" stroke-width="0.6" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="31" font-weight="900" letter-spacing="0">LIBRETTO</text>
    <text x="58" y="134" fill="#8c7f55" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="22" letter-spacing="1.4">BLOG</text>
  </g>
  <g filter="url(#amber-glow)">
  ${renderTextLines(titleLines)}
  </g>
  <text x="58" y="570" fill="#7f7a6b" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="22">libretto.sh/blog/${escapeXml(post.slug)}</text>
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
