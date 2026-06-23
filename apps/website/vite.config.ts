import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { comptime } from "comptime.ts/vite";
import { defineConfig } from "vite";
import { loadBlogPostInputs } from "./scripts/blog-posts.ts";

const comptimePlugin = await comptime();
const blogPosts = await loadBlogPostInputs();
const prerenderPaths = [
  "/",
  "/blog",
  "/brand-kit",
  "/vs/browser-use",
  "/vs/playwright-codegen",
  "/vs/stagehand",
  ...blogPosts.map((post) => `/blog/${post.slug}`),
];
const prerenderPathSet = new Set(prerenderPaths);

export default defineConfig({
  plugins: [
    comptimePlugin,
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        filter: ({ path }) => prerenderPathSet.has(path),
      },
      pages: prerenderPaths.map((path) => ({
        path,
        prerender: { enabled: true },
      })),
    }),
    react(),
  ],
  optimizeDeps: { exclude: ["comptime.ts"] },
  server: { allowedHosts: ["codybot.exe.xyz", "cody.tail14d4f7.ts.net"] },
});
