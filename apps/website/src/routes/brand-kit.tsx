import { createFileRoute } from "@tanstack/react-router";
import { BrandKitPage } from "../brand-kit/BrandKitPage";

export const Route = createFileRoute("/brand-kit")({
  head: () => ({
    meta: [
      { title: "Libretto Brand Kit" },
      {
        name: "description",
        content: "Libretto brand assets, typography, color tokens, and export controls.",
      },
    ],
  }),
  component: BrandKitPage,
});
