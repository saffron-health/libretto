/// <reference types="node" />

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mdxParse } from "safe-mdx/parse";

const POSTS_DIR = fileURLToPath(new URL("../posts/", import.meta.url));

const REQUIRED_FRONTMATTER_FIELDS = [
  "title",
  "description",
  "publishedAt",
  "readingTime",
];

export type BlogPostInput = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  readingTime: string;
  markdown: string;
  faqs: BlogPostFaq[];
  ogImage: string;
};

export type BlogPostFaq = {
  question: string;
  answer: string;
};

export type BlogPost = BlogPostInput & {
  mdast: ReturnType<typeof mdxParse>;
};

function parseFrontmatterValue(rawValue: string): string {
  const value = rawValue.trim();

  if (value.startsWith('"')) {
    const parsedValue: unknown = JSON.parse(value);
    if (typeof parsedValue !== "string") {
      throw new Error(`Expected frontmatter value to parse as a string`);
    }
    return parsedValue;
  }

  return value;
}

function parseFrontmatter(
  filePath: string,
  source: string,
): { frontmatter: Record<string, string>; markdown: string } {
  const normalizedSource = source.replace(/\r\n/g, "\n");

  if (!normalizedSource.startsWith("---\n")) {
    throw new Error(`Blog post ${filePath} must start with YAML frontmatter`);
  }

  const frontmatterEnd = normalizedSource.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error(
      `Blog post ${filePath} is missing closing frontmatter marker`,
    );
  }

  const frontmatter: Record<string, string> = {};
  const frontmatterSource = normalizedSource.slice(4, frontmatterEnd);
  for (const line of frontmatterSource.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid frontmatter line in ${filePath}: ${line}`);
    }

    const [, key, rawValue] = match;
    frontmatter[key] = parseFrontmatterValue(rawValue);
  }

  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (
      typeof frontmatter[field] !== "string" ||
      frontmatter[field].length === 0
    ) {
      throw new Error(
        `Blog post ${filePath} is missing required string frontmatter field ${field}`,
      );
    }
  }

  return {
    frontmatter,
    markdown: normalizedSource.slice(frontmatterEnd + "\n---\n".length),
  };
}

function stripMarkdownFormatting(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBlogPostFaqs(markdown: string): BlogPostFaq[] {
  const lines = markdown.split("\n");
  const faqStart = lines.findIndex(
    (line) => line.trim() === "## Frequently Asked Questions",
  );

  if (faqStart === -1) {
    return [];
  }

  const faqs: BlogPostFaq[] = [];
  let question: string | undefined;
  let answerLines: string[] = [];

  function flushFaq() {
    const answer = stripMarkdownFormatting(answerLines.join(" "));
    if (question && answer) {
      faqs.push({ question, answer });
    }
    question = undefined;
    answerLines = [];
  }

  for (const line of lines.slice(faqStart + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    if (line.startsWith("### ")) {
      flushFaq();
      question = stripMarkdownFormatting(line.slice("### ".length));
      continue;
    }

    if (question && line.trim() !== "") {
      answerLines.push(line.trim());
    }
  }

  flushFaq();
  return faqs;
}

function readBlogPost(fileName: string, source: string): BlogPostInput {
  const slug = basename(fileName, extname(fileName));
  const { frontmatter, markdown } = parseFrontmatter(fileName, source);

  return {
    slug,
    title: frontmatter.title,
    description: frontmatter.description,
    publishedAt: frontmatter.publishedAt,
    readingTime: frontmatter.readingTime,
    markdown,
    faqs: extractBlogPostFaqs(markdown),
    ogImage: `/blog/${slug}/og-image.png`,
  };
}

export async function loadBlogPostInputs(): Promise<BlogPostInput[]> {
  const fileNames = (await readdir(POSTS_DIR)).filter((fileName) =>
    fileName.endsWith(".md") && fileName !== "AGENTS.md",
  );

  const posts = await Promise.all(
    fileNames.map(async (fileName) => {
      const postPath = join(POSTS_DIR, fileName);
      return readBlogPost(fileName, await readFile(postPath, "utf8"));
    }),
  );

  posts.sort((left, right) => {
    const dateOrder = right.publishedAt.localeCompare(left.publishedAt);
    return dateOrder === 0 ? left.slug.localeCompare(right.slug) : dateOrder;
  });

  return posts;
}

export async function loadBlogPosts(): Promise<BlogPost[]> {
  const posts = await loadBlogPostInputs();

  return posts.map((post) => ({
    ...post,
    mdast: mdxParse(post.markdown),
  }));
}
