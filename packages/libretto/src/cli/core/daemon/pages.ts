import type { Page } from "playwright";

export function handlePages(
  pageById: Map<string, Page>,
  activePage: Page,
): Array<{ id: string; url: string; active: boolean }> {
  const results: Array<{ id: string; url: string; active: boolean }> = [];
  // If the original active page has been closed (no longer in the map),
  // fall back to the last tracked page.
  const isActiveTracked = [...pageById.values()].includes(activePage);
  const effectiveActive = isActiveTracked
    ? activePage
    : [...pageById.values()].at(-1);
  for (const [id, page] of pageById) {
    const url = page.url();
    if (url.startsWith("devtools://") || url.startsWith("chrome-error://"))
      continue;
    results.push({ id, url, active: page === effectiveActive });
  }
  return results;
}
