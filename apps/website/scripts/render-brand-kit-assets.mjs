import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wordmarkDir = join(root, "public", "brand-kit", "wordmark");
const lockupDir = join(root, "public", "brand-kit", "lockup");
const logosDir = join(root, "public", "logos");
const fontsDir = join(root, "public", "fonts");

mkdirSync(wordmarkDir, { recursive: true });
mkdirSync(lockupDir, { recursive: true });

const asciiLogo = String.raw` ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

async function renderWordmarkAssets() {
  const commitMono = readFileSync(join(fontsDir, "CommitMono-VF.woff2")).toString("base64");
  const lines = asciiLogo.split("\n");
  const lineHeight = 34;
  const fontSize = 28;
  const x = 40;
  const y = 58;
  const textLines = lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-family="Commit Mono, ui-monospace, monospace" font-size="${fontSize}" font-weight="400" letter-spacing="0" xml:space="preserve">${escapeXml(line)}</text>`,
    )
    .join("\n  ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="260" viewBox="0 0 1360 260">
  <title>Libretto ASCII wordmark</title>
  <defs>
    <style>
      @font-face {
        font-family: "Commit Mono";
        src: url("data:font/woff2;base64,${commitMono}") format("woff2");
        font-weight: 400 700;
        font-style: normal;
      }
    </style>
    <filter id="ascii-glow-tight" x="-12%" y="-60%" width="124%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    <filter id="ascii-glow-wide" x="-20%" y="-100%" width="140%" height="300%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <rect width="1360" height="260" fill="transparent"/>
  <g fill="#F0CF5A" opacity="0.25" filter="url(#ascii-glow-wide)">
  ${textLines}
  </g>
  <g fill="#F0CF5A" opacity="0.5" filter="url(#ascii-glow-tight)">
  ${textLines}
  </g>
  <g fill="#F0CF5A">
  ${textLines}
  </g>
</svg>
`;
  const svgPath = join(wordmarkDir, "libretto-ascii-wordmark.svg");
  writeFileSync(svgPath, svg);
  const png = await renderAsciiPreviewPng({ asciiLogo, commitMono });
  writeFileSync(join(wordmarkDir, "libretto-ascii-wordmark.png"), png);
  await sharp(png)
    .webp({ quality: 95 })
    .toFile(join(wordmarkDir, "libretto-ascii-wordmark.webp"));
}

async function renderAsciiPreviewPng({ asciiLogo, commitMono }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 4,
      viewport: { width: 900, height: 260 },
    });
    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      @font-face {
        font-family: "Commit Mono";
        src: url("data:font/woff2;base64,${commitMono}") format("woff2");
        font-weight: 400 700;
        font-style: normal;
      }

      html,
      body {
        background: transparent;
        margin: 0;
        padding: 0;
      }

      body {
        align-items: flex-start;
        display: flex;
        justify-content: flex-start;
        padding: 24px;
      }

      pre {
        color: #f0cf5a;
        font-family: "Commit Mono", ui-monospace, monospace;
        font-size: 12px;
        font-weight: 400;
        letter-spacing: 0;
        line-height: 12px;
        margin: 0;
        padding: 18px 22px;
        white-space: pre;
      }
    </style>
  </head>
  <body>
    <pre aria-label="Libretto">${escapeHtml(asciiLogo)}</pre>
  </body>
</html>`);
    await page.evaluate(() => document.fonts.ready);
    const element = page.locator("pre");
    const screenshot = await element.screenshot({ omitBackground: true });
    return screenshot;
  } finally {
    await browser.close();
  }
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return escapeXml(value).replaceAll('"', "&quot;");
}

async function renderLockupAssets() {
  const fraunces = readFileSync(join(fontsDir, "Fraunces-Regular.ttf")).toString("base64");
  const variants = [
    {
      backgroundColor: "#111111",
      filename: "libretto-lockup-dark",
      logoFilename: "logo-dark.svg",
      title: "Libretto lockup for dark backgrounds",
      wordmarkColor: "#EBEEEB",
    },
    {
      backgroundColor: "#FFFFFF",
      filename: "libretto-lockup-light",
      logoFilename: "logo-light.svg",
      title: "Libretto lockup for light backgrounds",
      wordmarkColor: "#201F18",
    },
  ];

  for (const variant of variants) {
    const logo = readFileSync(join(logosDir, variant.logoFilename), "utf8");
    const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;
    const svg = renderLockupSvg({ ...variant, fraunces, logoDataUrl });
    const svgPath = join(lockupDir, `${variant.filename}.svg`);
    writeFileSync(svgPath, svg);
    const png = await renderLockupPreviewPng({ ...variant, fraunces, logoDataUrl });
    writeFileSync(join(lockupDir, `${variant.filename}.png`), png);
    await sharp(png)
      .webp({ quality: 95 })
      .toFile(join(lockupDir, `${variant.filename}.webp`));
  }
}

function renderLockupSvg({ backgroundColor, fraunces, logoDataUrl, title, wordmarkColor }) {
  const width = 938;
  const height = 400;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${title}</title>
  <defs>
    <style>
      @font-face {
        font-family: "Fraunces";
        src: url("data:font/ttf;base64,${fraunces}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
    </style>
  </defs>
  <foreignObject width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="align-items:center;background-color:${backgroundColor};box-sizing:border-box;display:flex;font-synthesis:none;gap:6px;height:${height}px;justify-content:center;-moz-osx-font-smoothing:grayscale;overflow:clip;padding:58px;-webkit-font-smoothing:antialiased;width:${width}px;">
      <div style="background-image:url('${logoDataUrl}');background-position:50%;background-size:cover;box-sizing:border-box;flex-shrink:0;height:53px;width:53px;"></div>
      <div style="box-sizing:border-box;color:${wordmarkColor};font-family:&quot;Fraunces&quot;, system-ui, sans-serif;font-size:48px;line-height:28px;">Libretto</div>
    </div>
  </foreignObject>
</svg>
`;
}

async function renderLockupPreviewPng({ fraunces, logoDataUrl, wordmarkColor }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 938, height: 400 },
    });
    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      @font-face {
        font-family: "Fraunces";
        src: url("data:font/ttf;base64,${fraunces}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }

      html,
      body {
        margin: 0;
        padding: 0;
      }

      .lockup {
        align-items: center;
        background-color: transparent;
        box-sizing: border-box;
        display: flex;
        font-synthesis: none;
        gap: 6px;
        height: 400px;
        justify-content: center;
        -moz-osx-font-smoothing: grayscale;
        overflow: clip;
        padding: 58px;
        -webkit-font-smoothing: antialiased;
        width: 938px;
      }

      .logo {
        background-image: url("${logoDataUrl}");
        background-position: 50%;
        background-size: cover;
        box-sizing: border-box;
        flex-shrink: 0;
        height: 53px;
        width: 53px;
      }

      .wordmark {
        box-sizing: border-box;
        color: ${wordmarkColor};
        font-family: "Fraunces", system-ui, sans-serif;
        font-size: 48px;
        line-height: 28px;
      }
    </style>
  </head>
  <body>
    <div class="lockup">
      <div class="logo"></div>
      <div class="wordmark">Libretto</div>
    </div>
  </body>
</html>`);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = await page.locator(".lockup").screenshot({
      omitBackground: true,
    });
    return screenshot;
  } finally {
    await browser.close();
  }
}

await renderWordmarkAssets();
await renderLockupAssets();

console.log("Rendered brand kit still assets.");
