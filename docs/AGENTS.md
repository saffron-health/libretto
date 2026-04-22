# Documentation Site (Mintlify)

Config in `docs.json`. Preview with `pnpm docs:dev` (runs on `localhost:3000`).

## Sidebar group names match URL folders

Each page's folder under `docs/` must equal its `docs.json` group name, lowercased and hyphenated (e.g. group `"CLI reference"` → `cli-reference/*`). When adding a page, put it in the matching folder and register it in `docs.json`.

## Testing

You can test the docs site with Libretto itself. Start the dev server, then use `libretto open` to open the local URL and verify pages render correctly.
