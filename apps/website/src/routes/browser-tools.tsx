import { createFileRoute } from "@tanstack/react-router";
import { BrowserToolsPage } from "../BrowserToolsPage";

const title = "Browser Tools SDK | Libretto";
const description =
  "Framework-native tools for AI agents to open real browsers, inspect pages, and act with Playwright.";
const url = "https://libretto.sh/browser-tools";

export const Route = createFileRoute("/browser-tools")({
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
  component: BrowserToolsPage,
});
