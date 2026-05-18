import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "mighty-lagoon", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
