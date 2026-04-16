import { defineConfig, type Plugin } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function markdownAccept(): Plugin {
  return {
    name: "markdown-accept",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const accept = req.headers.accept ?? "";
        if (accept.includes("text/markdown")) {
          const content = readFileSync(
            resolve(__dirname, "public/llms.txt"),
            "utf-8",
          );
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
          res.end(content);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [markdownAccept(), tailwindcss(), react()],
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { exclude: ["**/node_modules/**", "tmp/**"] },
  staged: { "*": "vp check --fix" },
});
