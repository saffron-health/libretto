import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadBlogPostInputs } from "./blog-posts.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandPath = join(root, "src", "brand.tsx");
const outputRoot = join(root, "public", "blog");
const brandSource = readFileSync(brandPath, "utf8");
const paperAsciihedronImage = readFileSync(join(root, "public", "og", "paper-asciihedron.png"));
const paperLogoImage = readFileSync(join(root, "public", "og", "paper-logo.png"));
const serifFont = readFileSync(join(root, "public", "fonts", "Fraunces-Regular.ttf"));
const monoFont = readFileSync(join(root, "public", "fonts", "CommitMono-VF.woff2"));

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const SITE_URL = "https://libretto.sh";

const brandName = readBrandStringConst("LIBRETTO_NAME");
const asciihedronDataUri = `data:image/png;base64,${paperAsciihedronImage.toString("base64")}`;
const logoDataUri = `data:image/png;base64,${paperLogoImage.toString("base64")}`;
const serifFontDataUri = `data:font/truetype;base64,${serifFont.toString("base64")}`;
const monoFontDataUri = `data:font/woff2;base64,${monoFont.toString("base64")}`;

function renderOgHtml(post) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Fraunces";
        font-style: normal;
        font-weight: 400;
        src: url("${serifFontDataUri}") format("truetype");
      }

      @font-face {
        font-family: "CommitMono";
        font-style: normal;
        font-weight: 400;
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
        -webkit-font-smoothing: antialiased;
        background: #111111;
        height: ${OG_HEIGHT}px;
        overflow: hidden;
        position: relative;
        width: ${OG_WIDTH}px;
      }

      .asciihedron {
        background-image: url("${asciihedronDataUri}");
        background-position: 50%;
        background-size: cover;
        height: 1380px;
        left: 449px;
        opacity: 0.24;
        position: absolute;
        top: -364px;
        width: 1380px;
      }

      .content {
        align-items: flex-start;
        display: flex;
        flex-direction: column;
        height: 485px;
        justify-content: space-between;
        left: 56px;
        position: absolute;
        top: 59px;
        width: 664px;
      }

      .brand {
        align-items: center;
        display: flex;
        gap: 8px;
        height: 42px;
      }

      .logo {
        background-image: url("${logoDataUri}");
        background-position: 50%;
        background-size: cover;
        height: 42px;
        width: 42px;
      }

      .wordmark {
        color: #ebeeeb;
        font-family: "Fraunces", system-ui, sans-serif;
        font-size: 38px;
        font-weight: 400;
        line-height: 1;
        white-space: nowrap;
      }

      .title {
        color: #ebeeeb;
        font-family: "Fraunces", system-ui, sans-serif;
        font-size: 72px;
        font-weight: 400;
        line-height: 78px;
        width: 664px;
      }

      .url {
        color: #ebeeeb;
        font-family: "CommitMono", ui-monospace, monospace;
        font-size: 24px;
        font-weight: 400;
        line-height: 24px;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="frame">
        <div class="asciihedron"></div>
        <div class="content">
          <div class="brand">
            <div class="logo"></div>
            <div class="wordmark">${escapeHtml(brandName)}</div>
          </div>
          <div class="title">${escapeHtml(post.title)}</div>
          <div class="url">${SITE_URL}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
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

function escapeHtml(value) {
  return escapeXml(value).replaceAll("'", "&#39;");
}

const browser = await chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { height: OG_HEIGHT, width: OG_WIDTH },
});

for (const post of await loadBlogPostInputs()) {
  const outputDir = join(outputRoot, post.slug);
  mkdirSync(outputDir, { recursive: true });
  await page.setContent(renderOgHtml(post), { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({
    animations: "disabled",
    path: join(outputDir, "og-image.png"),
    type: "png",
  });
}

await browser.close();

console.log("Rendered blog OG images.");
