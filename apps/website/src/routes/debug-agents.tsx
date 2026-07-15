import { createFileRoute } from "@tanstack/react-router";
import { DebugAgentsPage } from "../DebugAgentsPage";

const title = "Playwright PR Agents | Libretto";
const description =
  "Automatically investigate failing Playwright scripts against the live page and open a GitHub pull request with a proposed fix.";
const url = "https://libretto.sh/debug-agents";

export const Route = createFileRoute("/debug-agents")({
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
  component: DebugAgentsPage,
});
