import { defineConfig } from 'vite'
import { holocron } from '@holocron.so/vite'

export default defineConfig({
  // Production (libretto.sh proxy) serves the docs under /docs. Preview
  // deploys to *.holocron.so serve from the domain root, so they build with
  // DOCS_BASE_PATH=/ — hosted subpath previews would otherwise 404 on assets.
  base: process.env.DOCS_BASE_PATH || '/docs/',
  clearScreen: false,
  plugins: [holocron()],
})
