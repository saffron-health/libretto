import { createFileRoute } from "@tanstack/react-router";
import { ChromeExtensionPage } from "../ChromeExtensionPage";

const title = "Libretto for Chrome | Automate your work in Chrome";
const description =
  "Tell Libretto what you want done in Chrome. Complete one-time browser tasks or turn them into cloud workflows that run on demand or on a schedule.";
const url = "https://libretto.sh/chrome-extension";

export const Route = createFileRoute("/chrome-extension")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: ChromeExtensionPage,
});
