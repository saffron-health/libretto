import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logosDir = join(root, "public", "brand-kit", "logos");
const socialsDir = join(root, "public", "brand-kit", "socials");
const wordmarkDir = join(root, "public", "brand-kit", "wordmark");

mkdirSync(logosDir, { recursive: true });
mkdirSync(socialsDir, { recursive: true });
mkdirSync(wordmarkDir, { recursive: true });

const asciiLogo = String.raw` ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

const ogTitleAscii = String.raw`██████╗  ██████╗ ███╗   ██╗██╗████████╗  ███╗   ███╗ █████╗ ██╗  ██╗███████╗
██╔══██╗██╔═══██╗████╗  ██║╚═╝╚══██╔══╝  ████╗ ████║██╔══██╗██║ ██╔╝██╔════╝
██║  ██║██║   ██║██╔██╗ ██║      ██║     ██╔████╔██║███████║█████╔╝ █████╗
██║  ██║██║   ██║██║╚██╗██║      ██║     ██║╚██╔╝██║██╔══██║██╔═██╗ ██╔══╝
██████╔╝╚██████╔╝██║ ╚████║      ██║     ██║ ╚═╝ ██║██║  ██║██║  ██╗███████╗
╚═════╝  ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝

██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗    █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗
██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝
██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗
██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║
╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝

██████╗  ██████╗    █████╗    ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗██╗███████╗
██╔══██╗██╔═══██╗  ██╔══██╗   ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝╚═╝██╔════╝
██║  ██║██║   ██║  ███████║   ███████╗██║     ██████╔╝██║██████╔╝   ██║      ███████╗
██║  ██║██║   ██║  ██╔══██║   ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║      ╚════██║
██████╔╝╚██████╔╝  ██║  ██║   ███████║╚██████╗██║  ██║██║██║        ██║      ███████║
╚═════╝  ╚═════╝   ╚═╝  ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝      ╚══════╝

     ██╗ ██████╗ ██████╗
     ██║██╔═══██╗██╔══██╗
     ██║██║   ██║██████╔╝
██   ██║██║   ██║██╔══██╗
╚█████╔╝╚██████╔╝██████╔╝
 ╚════╝  ╚═════╝ ╚═════╝`;

const socialAssets = [
  {
    id: "x",
    profile: { width: 400, height: 400, logoScale: 0.34 },
    banner: {
      width: 1500,
      height: 500,
      textLeftRatio: 0.17,
      asciihedronXRatio: 0.53,
      asciihedronSizeRatio: 0.72,
      asciihedronOpacity: 0.32,
    },
  },
  {
    id: "reddit",
    profile: { width: 256, height: 256, logoScale: 0.36 },
    banner: {
      width: 1080,
      height: 128,
      layout: "one-line",
      compactAscii: true,
      centerAsciihedronSizeRatio: 0.9,
      asciihedronOpacity: 0.32,
    },
  },
  {
    id: "instagram",
    profile: { width: 320, height: 320, logoScale: 0.34 },
    banner: { width: 1080, height: 1080 },
  },
  {
    id: "linkedin",
    profile: { width: 400, height: 400, logoScale: 0.34 },
    banner: {
      width: 4200,
      height: 700,
      layout: "one-line",
      compactAscii: true,
      centerAsciihedronSizeRatio: 0.56,
      asciihedronOpacity: 0.24,
    },
  },
];

const ogHeadline = "DON'T MAKE BROWSER AGENTS DO A SCRIPT'S JOB";
const oneLineOgTitleAscii = createOneLineAscii(ogTitleAscii);
const compactOneLineOgTitleAscii = createCompactAscii(ogHeadline);

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

async function renderSocialAssets() {
  const logoSvg = readFileSync(join(logosDir, "libretto-icosahedron-yellow.svg"));
  const logoUrl = `data:image/svg+xml;base64,${logoSvg.toString("base64")}`;
  const asciihedronPng = readFileSync(join(logosDir, "libretto-asciihedron-still.png"));
  const asciihedronUrl = `data:image/png;base64,${asciihedronPng.toString("base64")}`;
  const font = readFileSync(join(root, "public", "fonts", "CommitMono-VF.woff2"));
  const fontUrl = `data:font/woff2;base64,${font.toString("base64")}`;
  const browser = await chromium.launch();

  try {
    for (const asset of socialAssets) {
      await renderSocialProfile(asset, logoUrl);
      await renderSocialBanner(asset, asciihedronUrl, fontUrl, browser);
    }
  } finally {
    await browser.close();
  }
}

async function renderSocialProfile(asset, logoUrl) {
  const { width, height, logoScale } = asset.profile;
  const logoSize = Math.round(Math.min(width, height) * logoScale);
  const logoX = (width - logoSize) / 2;
  const logoY = (height - logoSize) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="profileBg" cx="50%" cy="50%" r="72%">
      <stop offset="0%" stop-color="#202320"/>
      <stop offset="64%" stop-color="#171917"/>
      <stop offset="100%" stop-color="#111111"/>
    </radialGradient>
    <filter id="goldGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${Math.max(5, width * 0.02)}" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.94 0 1 0 0 0.81 0 0 1 0 0.35 0 0 0 0.55 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#profileBg)"/>
  <image href="${logoUrl}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" filter="url(#goldGlow)"/>
</svg>
`;

  await sharp(Buffer.from(svg))
    .png({ adaptiveFiltering: true, compressionLevel: 9 })
    .toFile(join(socialsDir, `${asset.id}-profile.png`));
}

async function renderSocialBanner(asset, asciihedronUrl, fontUrl, browser) {
  const { width, height, crop, layout } = asset.banner;
  if (layout === "one-line") {
    await renderOneLineSocialBanner(asset, asciihedronUrl, fontUrl, browser);
    return;
  }

  const isSquare = width === height;
  const lines = crop === "headline" ? ogTitleAscii.split("\n").slice(0, 6) : ogTitleAscii.split("\n");
  const maxLineLength = Math.max(...lines.map((line) => line.length));
  const textWidth = width * (isSquare ? 0.86 : 0.62);
  const textHeight = height * (isSquare ? 0.56 : 0.72);
  const fontSize = Math.max(
    6,
    Math.min(textWidth / (maxLineLength * 0.58), textHeight / (lines.length * 1.02)),
  );
  const textX = Math.round(width * (asset.banner.textLeftRatio ?? (isSquare ? 0.06 : 0.055)));
  const textY = Math.round(
    height * (crop === "headline" ? 0.18 : isSquare ? 0.1 : 0.14),
  );
  const asciihedronSize = Math.round(
    asset.banner.asciihedronSizeRatio
      ? width * asset.banner.asciihedronSizeRatio
      : Math.max(width, height) * (isSquare ? 1.35 : 0.82),
  );
  const asciihedronX = Math.round(
    width * (asset.banner.asciihedronXRatio ?? (isSquare ? 0.18 : 0.5)),
  );
  const asciihedronY = Math.round((height - asciihedronSize) / 2);
  const asciihedronOpacity = asset.banner.asciihedronOpacity ?? (isSquare ? 0.16 : 0.18);
  const html = `<!doctype html>
<html>
  <head>
    <style>
      @font-face {
        font-family: "Commit Mono";
        src: url("${fontUrl}") format("woff2");
        font-weight: 100 900;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #111111;
      }
      .frame {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background:
          radial-gradient(circle at ${isSquare ? "68% 50%" : "73% 50%"}, #202320 0%, #171917 44%, #111111 78%),
          #111111;
      }
      .asciihedron {
        position: absolute;
        left: ${asciihedronX}px;
        top: ${asciihedronY}px;
        width: ${asciihedronSize}px;
        height: ${asciihedronSize}px;
        opacity: ${asciihedronOpacity};
        filter: brightness(1.35) contrast(1.08);
      }
      pre {
        position: absolute;
        left: ${textX}px;
        top: ${textY}px;
        margin: 0;
        color: #f0cf5a;
        font-family: "Commit Mono", ui-monospace, monospace;
        font-size: ${fontSize.toFixed(2)}px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.05em;
        white-space: pre;
        text-shadow:
          0 0 ${Math.max(7, fontSize * 0.62).toFixed(2)}px color-mix(in oklch, #f0cf5a 50%, transparent),
          0 0 ${Math.max(20, fontSize * 1.8).toFixed(2)}px color-mix(in oklch, #f0cf5a 25%, transparent);
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <img class="asciihedron" src="${asciihedronUrl}" alt="">
      <pre>${escapeHtml(lines.join("\n"))}</pre>
    </div>
  </body>
</html>`;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({
      path: join(socialsDir, `${asset.id}-banner.png`),
      omitBackground: false,
    });
  } finally {
    await page.close();
  }
}

async function renderOneLineSocialBanner(asset, asciihedronUrl, fontUrl, browser) {
  const { width, height } = asset.banner;
  const asciihedronSize = Math.round(width * asset.banner.centerAsciihedronSizeRatio);
  const asciihedronOpacity = asset.banner.asciihedronOpacity ?? 0.2;
  const text = asset.banner.compactAscii
    ? compactOneLineOgTitleAscii
    : oneLineOgTitleAscii;
  const lines = text.split("\n");
  const maxLineLength = Math.max(...lines.map((line) => line.length));
  const naturalFontSize = (width * 0.9) / (maxLineLength * 0.58);
  const fontSize = Math.max(
    naturalFontSize,
    Math.min(height * 0.075, 10),
  );
  const scaleX = Math.min(
    1,
    (width * 0.94) / (maxLineLength * fontSize * 0.58),
  );
  const html = `<!doctype html>
<html>
  <head>
    <style>
      @font-face {
        font-family: "Commit Mono";
        src: url("${fontUrl}") format("woff2");
        font-weight: 100 900;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #111111;
      }
      .frame {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background:
          radial-gradient(circle at 50% 50%, #202320 0%, #171917 45%, #111111 80%),
          #111111;
      }
      .asciihedron {
        position: absolute;
        left: 50%;
        top: 50%;
        width: ${asciihedronSize}px;
        height: ${asciihedronSize}px;
        opacity: ${asciihedronOpacity};
        filter: brightness(1.35) contrast(1.08);
        transform: translate(-50%, -50%);
      }
      pre {
        position: absolute;
        left: 50%;
        top: 50%;
        margin: 0;
        color: #f0cf5a;
        font-family: "Commit Mono", ui-monospace, monospace;
        font-size: ${fontSize.toFixed(2)}px;
        font-weight: 600;
        letter-spacing: -0.05em;
        line-height: 1;
        text-shadow:
          0 0 8px color-mix(in oklch, #f0cf5a 50%, transparent),
          0 0 24px color-mix(in oklch, #f0cf5a 25%, transparent);
        transform: translate(-50%, -50%) scaleX(${scaleX.toFixed(4)});
        transform-origin: center;
        white-space: pre;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <img class="asciihedron" src="${asciihedronUrl}" alt="">
      <pre aria-label="Don't make browser agents do a script's job">${escapeHtml(text)}</pre>
    </div>
  </body>
</html>`;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({
      path: join(socialsDir, `${asset.id}-banner.png`),
      omitBackground: false,
    });
  } finally {
    await page.close();
  }
}

function createOneLineAscii(value) {
  const chunks = value.split("\n\n").map((chunk) => chunk.split("\n"));
  const rowCount = Math.max(...chunks.map((chunk) => chunk.length));
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    chunks
      .map((chunk) => chunk[rowIndex] ?? "")
      .join("   ")
      .trimEnd(),
  ).join("\n");
}

function createCompactAscii(value) {
  const glyphs = {
    A: [" ██ ", "█  █", "████", "█  █", "█  █"],
    B: ["███ ", "█  █", "███ ", "█  █", "███ "],
    C: [" ███", "█   ", "█   ", "█   ", " ███"],
    D: ["███ ", "█  █", "█  █", "█  █", "███ "],
    E: ["████", "█   ", "███ ", "█   ", "████"],
    G: [" ███", "█   ", "█ ██", "█  █", " ███"],
    I: ["███", " █ ", " █ ", " █ ", "███"],
    J: ["  ██", "   █", "   █", "█  █", " ██ "],
    K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
    M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    N: ["█  █", "██ █", "█ ██", "█  █", "█  █"],
    O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
    P: ["███ ", "█  █", "███ ", "█   ", "█   "],
    R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
    S: [" ███", "█   ", " ██ ", "   █", "███ "],
    T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
    "'": ["█", "█", " ", " ", " "],
    " ": ["   ", "   ", "   ", "   ", "   "],
  };
  const characters = Array.from(value.toUpperCase());
  const rowCount = 5;
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    characters
      .map((character) => glyphs[character]?.[rowIndex] ?? character)
      .join(" ")
      .trimEnd(),
  ).join("\n");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

await renderLogoSizes();
await renderAsciihedronAssets();
await renderWordmarkAssets();
await renderSocialAssets();

console.log("Rendered brand kit still assets.");
