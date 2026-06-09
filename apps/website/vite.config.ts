import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { comptime } from "comptime.ts/vite";
import { fileURLToPath } from "node:url";

const comptimePlugin = await comptime();

export default defineConfig({
  plugins: [comptimePlugin, tailwindcss(), react()],
  optimizeDeps: { exclude: ["comptime.ts"] },
  server: { allowedHosts: ["codybot.exe.xyz", "cody.tail14d4f7.ts.net"] },
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
