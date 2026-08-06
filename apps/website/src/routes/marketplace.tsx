import { createFileRoute } from "@tanstack/react-router";
import { MarketplacePage } from "../MarketplacePage";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Workflow Marketplace | Libretto" },
      {
        name: "description",
        content: "Add reusable browser workflows to your Libretto account.",
      },
    ],
  }),
  component: MarketplacePage,
});
