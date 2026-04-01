import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        docs: fileURLToPath(new URL("./docs/index.html", import.meta.url)),
      },
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { exclude: ["**/node_modules/**", "tmp/**"] },
  staged: { "*": "vp check --fix" },
});
