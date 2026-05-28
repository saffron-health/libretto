import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logosDir = join(root, "public", "brand-kit", "logos");
const wordmarkDir = join(root, "public", "brand-kit", "wordmark");

mkdirSync(logosDir, { recursive: true });
mkdirSync(wordmarkDir, { recursive: true });

const asciiLogo = String.raw` ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

async function renderLogoSizes() {
  const source = join(logosDir, "libretto-icosahedron-yellow-1024.png");
  const sizes = [512, 256, 128, 64, 32];
  for (const size of sizes) {
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(join(logosDir, `libretto-icosahedron-yellow-${size}.png`));
  }
  await sharp(source)
    .resize(1024, 1024)
    .webp({ quality: 95 })
    .toFile(join(logosDir, "libretto-icosahedron-yellow-1024.webp"));
}

async function renderAsciihedronAssets() {
  const source = join(logosDir, "libretto-asciihedron-still.png");
  const dataUrl = `data:image/png;base64,${readFileSync(source).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2740" height="2740" viewBox="0 0 2740 2740">
  <title>Libretto asciihedron still</title>
  <image href="${dataUrl}" width="2740" height="2740"/>
</svg>
`;
  writeFileSync(join(logosDir, "libretto-asciihedron-still.svg"), svg);
  await sharp(source)
    .resize(1600, 1600, { fit: "inside" })
    .webp({ quality: 92 })
    .toFile(join(logosDir, "libretto-asciihedron-still.webp"));
}

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

await renderLogoSizes();
await renderAsciihedronAssets();
await renderWordmarkAssets();

console.log("Rendered brand kit still assets.");
