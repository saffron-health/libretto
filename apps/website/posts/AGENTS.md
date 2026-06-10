# Blog Posts

Blog posts are Markdown files loaded by `apps/website/scripts/blog-posts.ts`. Use one file per post, named with the final slug, for example `how-to-automate-browser-workflows.md`.

## Frontmatter

Each post must start with YAML-style frontmatter containing these string fields:

```md
---
title: "Post title"
description: "Short SEO/social description."
publishedAt: "2026-06-09"
readingTime: "7 min read"
---
```

The parser only supports simple `key: value` lines. Quote values that contain punctuation, and do not add nested objects, arrays, multiline strings, or custom structured data to frontmatter unless `apps/website/scripts/blog-posts.ts` is updated first.

## FAQ formatting

FAQ JSON-LD is generated from the visible FAQ section. Keep FAQ content in the Markdown body, not in inline `<script>` tags or duplicated frontmatter.

Use this exact structure when a post has FAQs:

```md
## Frequently Asked Questions

### First question?

Answer text in normal paragraphs.

### Second question?

Answer text in normal paragraphs.
```

The extractor looks for the exact heading `## Frequently Asked Questions`, then reads each `###` heading as a question and the following text as its answer until the next `###` or `##` heading. Changing this structure will prevent FAQPage JSON-LD from being generated correctly.

## Structured data

Do not embed inline JSON-LD scripts in post Markdown. Blog post and FAQ structured data are emitted centrally from `apps/website/src/blog/jsonLd.ts` using the parsed post metadata and FAQ section.

## OG images

Every post slug needs a generated image at `apps/website/public/blog/<slug>/og-image.png`. Run this after adding or renaming posts:

```bash
pnpm -s --filter @libretto/website render-blog-og
```
