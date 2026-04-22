# Documentation Site (Mintlify)

Config in `docs.json`. Preview with `pnpm docs:dev` (runs on `localhost:3000`).

## Sidebar group headers must match the URL path

When you add a new page, the sidebar group header it lives under must match the URL path segment for that page.

- Group `"Fundamentals"` → pages must live at `fundamentals/*`
- Group `"CLI reference"` → pages must live at `cli-reference/*`
- Group `"Hosting"` → pages must live at `hosting/*`

Concretely, the folder under `docs/` that holds a page's `.mdx` file must match (lowercased, hyphenated) the `group` name declared for it in `docs.json`. Don't drop a `fundamentals/foo.mdx` into a group called `"Get started"`. Move it into a folder whose name matches its group, and update the entry in `docs.json`.

This keeps the URL and the navigation label aligned, so readers landing on `/fundamentals/core-concepts` from search or a deep link always see the page listed under "Fundamentals" in the sidebar.

## Testing

You can test the docs site with Libretto itself. Start the dev server, then use `libretto open` to open the local URL and verify pages render correctly.
