import { createFileRoute } from "@tanstack/react-router";
import { BrandKitPage } from "../brand-kit/BrandKitPage";

const title = "Libretto Brand Kit";
const description = "Libretto brand assets, typography, color tokens, and export controls.";
const url = "https://libretto.sh/brand-kit";

export const Route = createFileRoute("/brand-kit")({
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
  component: BrandKitPage,
});
