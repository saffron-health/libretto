import type { mdxParse } from "safe-mdx/parse";

export type BlogPostInput = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  readingTime: string;
  markdown: string;
  ogImage: string;
};

export type BlogPost = BlogPostInput & {
  mdast: ReturnType<typeof mdxParse>;
};

export function loadBlogPostInputs(): Promise<BlogPostInput[]>;

export function loadBlogPosts(): Promise<BlogPost[]>;
