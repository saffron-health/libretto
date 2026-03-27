import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { exclude: ["**/node_modules/**", "tmp/**"] },
  staged: { "*": "vp check --fix" },
});
