import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "public", "og", "browser-tools.png");
const asciihedronImage = readFileSync(join(root, "public", "og", "paper-asciihedron.png"));
const monoFont = readFileSync(join(root, "public", "fonts", "CommitMono-VF.woff2"));

const OG_WIDTH = 1280;
const OG_HEIGHT = 640;

// ANSI Shadow — same font as the site OG / brand.tsx tagline art.
const TITLE_ASCII = String.raw`██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝

████████╗ ██████╗  ██████╗ ██╗     ███████╗
╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
   ██║   ██║   ██║██║   ██║██║     ███████╗
   ██║   ██║   ██║██║   ██║██║     ╚════██║
   ██║   ╚██████╔╝╚██████╔╝███████╗███████║
   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝

███████╗██████╗ ██╗  ██╗
██╔════╝██╔══██╗██║ ██╔╝
███████╗██║  ██║█████╔╝
╚════██║██║  ██║██╔═██╗
███████║██████╔╝██║  ██╗
╚══════╝╚═════╝ ╚═╝  ╚═╝`;

const asciihedronDataUri = `data:image/png;base64,${asciihedronImage.toString("base64")}`;
const monoFontDataUri = `data:font/woff2;base64,${monoFont.toString("base64")}`;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Commit Mono";
        font-style: normal;
        font-weight: 400 700;
        src: url("${monoFontDataUri}") format("woff2");
      }

      * {
        box-sizing: border-box;
        font-synthesis: none;
      }

      html,
      body,
      #root {
        height: ${OG_HEIGHT}px;
        margin: 0;
        width: ${OG_WIDTH}px;
      }

      body {
        background: #111111;
        overflow: hidden;
      }

      .frame {
        background: radial-gradient(circle at 76% 50%, #202320 0%, #171917 48%, #111111 100%);
        height: ${OG_HEIGHT}px;
        overflow: hidden;
        position: relative;
        width: ${OG_WIDTH}px;
      }

      .asciihedron {
        background-image: url("${asciihedronDataUri}");
        background-position: 50%;
        background-size: cover;
        filter: brightness(1.15) contrast(1.05);
        height: 1370px;
        left: 60%;
        opacity: 0.18;
        position: absolute;
        top: 50%;
        transform: translate(-25%, -50%);
        width: 1370px;
      }

      .title {
        color: #f0cf5a;
        filter:
          drop-shadow(0 0 8px rgba(240, 207, 90, 0.45))
          drop-shadow(0 0 24px rgba(240, 207, 90, 0.25));
        font-family: "Commit Mono", ui-monospace, monospace;
        font-size: 18px;
        font-weight: 600;
        left: 56px;
        letter-spacing: -0.05em;
        line-height: 1;
        margin: 0;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        white-space: pre;
        width: 720px;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="frame">
        <div class="asciihedron" aria-hidden="true"></div>
        <pre class="title" aria-label="Browser Tools SDK">${escapeHtml(TITLE_ASCII)}</pre>
      </div>
    </div>
  </body>
</html>`;
}

mkdirSync(dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { height: OG_HEIGHT, width: OG_WIDTH },
  });
  await page.setContent(renderHtml(), { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const png = await page.screenshot({
    animations: "disabled",
    type: "png",
  });
  await sharp(png)
    .resize(OG_WIDTH, OG_HEIGHT)
    .png()
    .toFile(outputPath);
  console.log(`Rendered ${outputPath}`);
} finally {
  await browser.close();
}
