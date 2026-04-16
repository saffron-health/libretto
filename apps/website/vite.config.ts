import { defineConfig, type Plugin } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const llmsContent = readFileSync(resolve(__dirname, "public/llms.txt"), "utf-8");

function llmsMarkdownContentType(): Plugin {
  return {
    name: "llms-markdown-content-type",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/llms.txt") {
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
          res.end(llmsContent);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [llmsMarkdownContentType(), tailwindcss(), react()],
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { exclude: ["**/node_modules/**", "tmp/**"] },
  staged: { "*": "vp check --fix" },
});
