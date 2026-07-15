import { createFileRoute } from "@tanstack/react-router";
import { CliProductPage } from "../CliProductPage";

const title = "Libretto CLI | Turn website workflows into reliable APIs";
const description =
  "Libretto is an open-source CLI that turns website workflows into fast, reusable scripts in your codebase.";
const url = "https://libretto.sh/cli";

export const Route = createFileRoute("/cli")({
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
  component: CliProductPage,
});
