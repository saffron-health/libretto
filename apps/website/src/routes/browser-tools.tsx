import { createFileRoute } from "@tanstack/react-router";
import { BrowserToolsPage } from "../BrowserToolsPage";

const title = "Browser Tools SDK | Libretto";
const description =
  "Six tools let any AI agent open a real browser, read the page, and act with Playwright.";
const url = "https://libretto.sh/browser-tools";
const imageUrl = "https://libretto.sh/og/browser-tools-v2.png";
const imageAlt = "Browser Tools SDK";

export const Route = createFileRoute("/browser-tools")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: imageUrl },
      { property: "og:image:alt", content: imageAlt },
      { property: "og:image:width", content: "1280" },
      { property: "og:image:height", content: "640" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: imageUrl },
      { name: "twitter:image:alt", content: imageAlt },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: BrowserToolsPage,
});
