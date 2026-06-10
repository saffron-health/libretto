import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBlogPostInputs } from "./blog-posts.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = resolve(SCRIPT_DIR, "..");
const PUBLIC_DIR = join(WEBSITE_DIR, "public");
const DIST_DIR = join(WEBSITE_DIR, "dist");
const SITE_URL = "https://libretto.sh";

async function readBlogPosts() {
  const posts = await loadBlogPostInputs();

  if (posts.length === 0) {
    throw new Error(`No blog posts found in ${join(WEBSITE_DIR, "posts")}`);
  }

  return posts;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getPostUrl(post) {
  return `${SITE_URL}/blog/${post.slug}`;
}

function getPostImageUrl(post) {
  return `${SITE_URL}${post.ogImage}`;
}

function upsertMeta(html, attribute, key, content) {
  const escapedContent = escapeHtml(content);
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`,
  );
  const replacement = `<meta ${attribute}="${key}" content="${escapedContent}" />`;

  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }

  return html.replace("</head>", `    ${replacement}\n  </head>`);
}

function upsertCanonical(html, href) {
  const escapedHref = escapeHtml(href);
  const pattern = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/;
  const replacement = `<link rel="canonical" href="${escapedHref}" />`;

  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }

  return html.replace("</head>", `    ${replacement}\n  </head>`);
}

function upsertTitle(html, title) {
  return html.replace(
    /<title>.*?<\/title>/,
    `<title>${escapeHtml(title)}</title>`,
  );
}

function getBlogPostHtml(baseHtml, post) {
  const title = `${post.title} | Libretto Blog`;
  const postUrl = getPostUrl(post);
  const imageUrl = getPostImageUrl(post);

  let html = upsertTitle(baseHtml, title);
  html = upsertCanonical(html, postUrl);
  html = upsertMeta(html, "name", "description", post.description);
  html = upsertMeta(html, "property", "og:type", "article");
  html = upsertMeta(html, "property", "og:title", title);
  html = upsertMeta(html, "property", "og:description", post.description);
  html = upsertMeta(html, "property", "og:url", postUrl);
  html = upsertMeta(html, "property", "og:image", imageUrl);
  html = upsertMeta(html, "property", "og:image:width", "1200");
  html = upsertMeta(html, "property", "og:image:height", "630");
  html = upsertMeta(html, "name", "twitter:card", "summary_large_image");
  html = upsertMeta(html, "name", "twitter:title", title);
  html = upsertMeta(html, "name", "twitter:description", post.description);
  html = upsertMeta(html, "name", "twitter:image", imageUrl);

  return html;
}

function assertBlogOgImages(posts) {
  const missing = posts
    .map((post) => join(PUBLIC_DIR, post.ogImage))
    .filter((imagePath) => !existsSync(imagePath));

  if (missing.length > 0) {
    throw new Error(
      `Missing blog OG image(s):\n${missing.map((path) => `- ${path}`).join("\n")}`,
    );
  }
}

function generateBlogHtml(posts) {
  const baseHtmlPath = join(DIST_DIR, "index.html");
  if (!existsSync(baseHtmlPath)) {
    throw new Error(
      `Build output not found at ${baseHtmlPath}. Run vp build first.`,
    );
  }

  const baseHtml = readFileSync(baseHtmlPath, "utf8");
  for (const post of posts) {
    const html = getBlogPostHtml(baseHtml, post);
    const outputPaths = [
      join(DIST_DIR, "blog", `${post.slug}.html`),
      join(DIST_DIR, "blog", post.slug, "index.html"),
    ];

    for (const outputPath of outputPaths) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, html);
    }
  }
}

function assertGeneratedBlogHtml(posts) {
  const missing = [];
  const mismatched = [];

  for (const post of posts) {
    const outputPaths = [
      join(DIST_DIR, "blog", `${post.slug}.html`),
      join(DIST_DIR, "blog", post.slug, "index.html"),
    ];

    for (const outputPath of outputPaths) {
      if (!existsSync(outputPath)) {
        missing.push(outputPath);
        continue;
      }

      const html = readFileSync(outputPath, "utf8");
      const imageUrl = getPostImageUrl(post);
      if (
        !html.includes(`<meta property="og:image" content="${imageUrl}"`) ||
        !html.includes(`<meta name="twitter:image" content="${imageUrl}"`)
      ) {
        mismatched.push(outputPath);
      }
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    const messages = [];
    if (missing.length > 0) {
      messages.push(
        `Missing generated blog HTML:\n${missing.map((path) => `- ${path}`).join("\n")}`,
      );
    }
    if (mismatched.length > 0) {
      messages.push(
        `Generated blog HTML does not reference the post OG image:\n${mismatched
          .map((path) => `- ${path}`)
          .join("\n")}`,
      );
    }
    throw new Error(messages.join("\n\n"));
  }
}

async function main() {
  const mode = process.argv[2];
  const posts = await readBlogPosts();

  if (mode === "generate") {
    assertBlogOgImages(posts);
    generateBlogHtml(posts);
    return;
  }

  if (mode === "check") {
    assertBlogOgImages(posts);
    if (existsSync(join(DIST_DIR, "index.html"))) {
      assertGeneratedBlogHtml(posts);
    }
    return;
  }

  throw new Error("Usage: node scripts/blog-og-metadata.mjs <generate|check>");
}

await main();
