import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { comptime } from "comptime.ts/vite";
import { defineConfig, type Plugin } from "vite";
import { loadBlogPostInputs } from "./scripts/blog-posts.ts";
import { dashboardPrerenderPaths } from "./src/dashboardSections.ts";

function withoutViteQuery(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

async function comptimePlugin(): Promise<Plugin> {
  const plugin = await comptime();
  const load = plugin.load;
  plugin.enforce = "pre";
  if (typeof load === "function") {
    plugin.load = async function loadWithoutViteQuery(id, options) {
      return load.call(this, withoutViteQuery(id), options);
    };
  }
  return plugin;
}

const comptimeVitePlugin = await comptimePlugin();
const blogPosts = await loadBlogPostInputs();
const blogPostPaths = blogPosts.map((post) => `/blog/${post.slug}`);
const dashboardPaths = dashboardPrerenderPaths;

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
    comptimeVitePlugin,
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
      },
      pages: [
        ...blogPostPaths,
        ...dashboardPaths,
        "/open-workflows",
        "/workflow-catalogue",
      ].map((path) => ({
        path,
        prerender: { enabled: true },
      })),
    }),
    react(),
  ],
  optimizeDeps: { exclude: ["comptime.ts"] },
  server: { allowedHosts: ["codybot.exe.xyz", "cody.tail14d4f7.ts.net"] },
});
