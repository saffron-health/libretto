import { createFileRoute } from "@tanstack/react-router";
import { BrowserUsePage } from "../../vs/BrowserUsePage";

const title = "Libretto vs Browser Use: deterministic scripts vs a runtime agent";
const description =
  "A developer-focused comparison of Libretto and Browser Use for AI browser automation: runtime agents, deterministic scripts, speed, debuggability, and production trade-offs.";
const url = "https://libretto.sh/vs/browser-use";

export const Route = createFileRoute("/vs/browser-use")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: BrowserUsePage,
});
