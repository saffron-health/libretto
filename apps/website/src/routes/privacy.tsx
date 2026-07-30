import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "../PrivacyPage";

const title = "Privacy Policy | Libretto";
const description = "How Libretto collects, uses, shares, and protects data.";
const url = "https://libretto.sh/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: PrivacyPage,
});
