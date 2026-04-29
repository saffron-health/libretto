import type { Page } from "playwright";

export function handlePages(
  pageById: Map<string, Page>,
  activePage: Page,
): Array<{ id: string; url: string; active: boolean }> {
  const results: Array<{ id: string; url: string; active: boolean }> = [];
  for (const [id, page] of pageById) {
    const url = page.url();
    if (url.startsWith("devtools://") || url.startsWith("chrome-error://"))
      continue;
    results.push({ id, url, active: page === activePage });
  }
  return results;
}
