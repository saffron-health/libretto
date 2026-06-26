import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { comptime } from "comptime.ts/vite";
import { defineConfig } from "vite";
import { loadBlogPostInputs } from "./scripts/blog-posts.ts";

const comptimePlugin = await comptime();
const blogPosts = await loadBlogPostInputs();
const blogPostPaths = blogPosts.map((post) => `/blog/${post.slug}`);

export default defineConfig({
  plugins: [
    comptimePlugin,
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
      },
      pages: blogPostPaths.map((path) => ({
        path,
        prerender: { enabled: true },
      })),
    }),
    react(),
  ],
  optimizeDeps: { exclude: ["comptime.ts"] },
  server: { allowedHosts: ["codybot.exe.xyz", "cody.tail14d4f7.ts.net"] },
});
