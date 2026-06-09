import { comptime } from "comptime.ts" with { type: "comptime" };
import { loadBlogPosts } from "../../scripts/blog-posts.mjs" with { type: "comptime" };
import type { BlogPost } from "../../scripts/blog-posts.mjs";

export const BLOG_POSTS = comptime(loadBlogPosts()) satisfies BlogPost[];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
