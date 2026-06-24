import { createFileRoute } from "@tanstack/react-router";
import { StagehandPage } from "../vs/StagehandPage";

const title = "Libretto vs Stagehand: compiled scripts vs runtime AI primitives";
const description =
  "A developer-focused comparison of Libretto and Browserbase Stagehand for AI browser automation: act(), observe(), caching, deterministic scripts, and runtime inference trade-offs.";
const url = "https://libretto.sh/vs/stagehand";

export const Route = createFileRoute("/vs/stagehand")({
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
  component: StagehandPage,
});
