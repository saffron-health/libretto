import { createFileRoute } from "@tanstack/react-router";
import { PlaywrightCodegenPage } from "../vs/PlaywrightCodegenPage";

const title = "Libretto vs Playwright codegen: workflow compiler vs browser recorder";
const description =
  "A developer-focused comparison of Libretto and Playwright codegen for deterministic browser automation, generated code, network shortcuts, debugging, and maintenance.";
const url = "https://libretto.sh/vs/playwright-codegen";

export const Route = createFileRoute("/vs/playwright-codegen")({
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
  component: PlaywrightCodegenPage,
});
