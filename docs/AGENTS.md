# Documentation Site (Mintlify)

This top-level `docs/` directory is the user-facing Mintlify documentation site. Put internal implementation notes and maintainer references under the relevant package instead, such as `packages/libretto/docs/`.

Config in `docs.json`. Preview with `pnpm docs:dev` (runs on `localhost:3000`).

## Navigation should follow URL structure

A page's file path determines its URL. When adding a page, put it in the folder for the intended URL and register it under the appropriate `docs.json` tab and group. For example, the `"Guides"` group contains `/guides/*` pages from `docs/guides/*.mdx`, while the `"Reference"` tab contains `/reference/cli/*` and `/reference/runtime/*` groups.

## Testing

You can test the docs site with Libretto itself. Start the dev server, then use `npx libretto open` to open the local URL and verify pages render correctly.
