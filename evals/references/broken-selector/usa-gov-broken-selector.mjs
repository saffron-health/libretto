import { workflow } from "libretto";

export const extractUsaGovTopic = workflow(async ({ page }, input) => {
  const query =
    typeof input?.query === "string" && input.query.trim().length > 0
      ? input.query.trim()
      : "passport renewal";

  await page.goto("https://www.usa.gov/", { waitUntil: "domcontentloaded" });

  const searchInput = page.locator('[data-eval-selector="usa-search-input"]').first();
  await searchInput.fill(query);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded");

  const anchors = await page.locator("main h2 a, main h3 a, main li a").all();
  const results = [];
  for (const anchor of anchors) {
    if (results.length >= 5) break;
    const title = ((await anchor.textContent()) ?? "").trim();
    const href = (await anchor.getAttribute("href")) ?? "";
    if (title.length === 0 || href.length === 0) continue;
    results.push({ title, href });
  }

  const firstHref = results[0]?.href ?? "";
  const firstUrl =
    firstHref.length > 0 ? new URL(firstHref, page.url()).toString() : "";

  if (firstUrl.length > 0) {
    await page.goto(firstUrl, { waitUntil: "domcontentloaded" });
  }

  return {
    query,
    results,
    resultCount: results.length,
    firstResultUrl: firstUrl,
    finalUrl: page.url(),
    finalTitle: await page.title(),
    finalHeading: ((await page.locator("h1").first().textContent()) ?? "").trim(),
  };
});
