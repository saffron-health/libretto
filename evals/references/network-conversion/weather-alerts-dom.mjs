import { workflow } from "libretto";

export const collectWeatherAlertsFromDom = workflow("collectWeatherAlertsFromDom", async ({ page }, input) => {
  const requestedState =
    typeof input?.state === "string" && input.state.trim().length > 0
      ? input.state.trim().toUpperCase()
      : "CA";

  const numericLimit = Number(input?.limit);
  const limit = Number.isFinite(numericLimit)
    ? Math.max(1, Math.min(25, Math.floor(numericLimit)))
    : 5;

  await page.goto(
    `https://api.weather.gov/alerts/active?area=${encodeURIComponent(requestedState)}`,
    { waitUntil: "domcontentloaded" },
  );

  const raw = (await page.locator("pre").first().textContent()) ?? "{\"features\":[]}";
  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed.features) ? parsed.features : [];

  const alerts = [];
  for (const feature of features.slice(0, limit)) {
    const properties =
      feature && typeof feature === "object" && "properties" in feature
        ? feature.properties
        : {};
    alerts.push({
      id: String(
        feature && typeof feature === "object" && "id" in feature ? feature.id : "",
      ),
      headline:
        properties && typeof properties === "object" && "headline" in properties
          ? String(properties.headline)
          : "",
      severity:
        properties && typeof properties === "object" && "severity" in properties
          ? String(properties.severity)
          : "",
    });
  }

  return {
    state: requestedState,
    alerts,
  };
});
