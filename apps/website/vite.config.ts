import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: { allowedHosts: ["codybot.exe.xyz"] },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        brandKit: fileURLToPath(new URL("./brand-kit.html", import.meta.url)),
      },
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { exclude: ["**/node_modules/**", "tmp/**"] },
  staged: { "*": "vp check --fix" },
});
