# Pages and Page Targeting

Use this reference when a Libretto session has multiple open pages and you need to inspect or target the right one.

## When to Use This

- The workflow opens a popup, new tab, or secondary page.
- `exec` or `snapshot` fails because more than one page is open.
- You are not sure which page in the session holds the relevant state.

## Workflow

- List the open pages in the session.
- Identify the page you want by URL.
- Re-run the command against that page.

## Commands

```bash
npx libretto pages --session debug-flow
npx libretto exec --session debug-flow --page <page-id> "return await page.url()"
npx libretto snapshot --session debug-flow --page <page-id> --objective "Find the active form"
```

## Notes

- A session can contain more than one page.
- When multiple pages are open, think about page targeting first before debugging selectors.
- Use `pages` to resolve the correct page id, then pass `--page` to `exec` or `snapshot` when needed.
