import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wordmarkDir = join(root, "public", "brand-kit", "wordmark");

mkdirSync(wordmarkDir, { recursive: true });

const asciiLogo = String.raw` ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

async function renderWordmarkAssets() {
  const lines = asciiLogo.split("\n");
  const lineHeight = 34;
  const fontSize = 28;
  const x = 40;
  const y = 58;
  const text = lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="#F0CF5A" font-family="Commit Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="${fontSize}" font-weight="800" xml:space="preserve">${escapeXml(line)}</text>`,
    )
    .join("\n  ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="260" viewBox="0 0 1360 260">
  <title>Libretto ASCII wordmark</title>
  <rect width="1360" height="260" fill="transparent"/>
  ${text}
</svg>
`;
  const svgPath = join(wordmarkDir, "libretto-ascii-wordmark.svg");
  writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg)).png().toFile(join(wordmarkDir, "libretto-ascii-wordmark.png"));
  await sharp(Buffer.from(svg))
    .webp({ quality: 95 })
    .toFile(join(wordmarkDir, "libretto-ascii-wordmark.webp"));
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

await renderWordmarkAssets();

console.log("Rendered brand kit still assets.");
