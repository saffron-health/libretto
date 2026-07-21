# Documentation Site (Holocron)

This top-level `docs/` directory is the user-facing Holocron documentation site. Put internal implementation notes and maintainer references under the relevant package instead, such as `packages/libretto/docs/`.

Config in `docs.json`. Preview with `pnpm docs:dev` (runs on `localhost:5173`).

## Navigation should follow URL structure

A page's file path determines its URL. When adding a page, put it in the folder for the intended URL and register it under the appropriate `docs.json` tab and group. For example, the `"Guides"` group contains `/guides/*` pages from `docs/guides/*.mdx`, while the `"Reference"` tab contains `/reference/cli/*` and `/reference/runtime/*` groups.

## Updating Holocron

Bump `@holocron.so/vite` in this package when a newer release is available:

```bash
pnpm --dir docs update @holocron.so/vite@latest
pnpm install
pnpm docs:build
```

`@cloudflare/vite-plugin` (pulled in by Holocron) peers `wrangler`. Keep `docs` on a `wrangler` version that satisfies that peer (currently `^4.110.0`). If the build fails on a wrangler peer mismatch, bump `wrangler` in `docs/package.json` and reinstall.

If already on the latest Holocron and the docs build still passes, do not open a PR.

## Testing

You can test the docs site with Libretto itself. Start the dev server, then use `npx libretto open` to open the local URL and verify pages render correctly.
