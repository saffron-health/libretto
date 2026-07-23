import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { comptime } from "comptime.ts/vite";
import { defineConfig, type Plugin } from "vite";
import { loadBlogPostInputs } from "./scripts/blog-posts.ts";

const comptimePlugin = await comptime();
const blogPosts = await loadBlogPostInputs();
const blogPostPaths = blogPosts.map((post) => `/blog/${post.slug}`);

function localDocsRedirectPlugin(): Plugin {
  return {
    name: "local-docs-redirect",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "/";
        if (url === "/docs" || url.startsWith("/docs/") || url.startsWith("/docs?")) {
          const docsPath =
            url === "/docs"
              ? "/"
              : url.startsWith("/docs?")
                ? `/${url.slice("/docs".length)}`
                : url.slice("/docs".length);
          response.writeHead(302, { location: `http://localhost:3000${docsPath}` });
          response.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    localDocsRedirectPlugin(),
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
