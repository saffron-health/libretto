# Documentation Site (Mintlify)

Config in `docs.json`. Preview with `pnpm docs:dev` (runs on `localhost:3000`).

## Sidebar group name must match the URL

A page's URL prefix must match its `docs.json` group name, lowercased and hyphenated. For example, group `"CLI reference"` maps to URL `/cli-reference/*`, with files at `docs/cli-reference/*.mdx`. When adding a page, put it in the matching folder and register it in `docs.json`.

## Testing

You can test the docs site with Libretto itself. Start the dev server, then use `npx libretto open` to open the local URL and verify pages render correctly.
