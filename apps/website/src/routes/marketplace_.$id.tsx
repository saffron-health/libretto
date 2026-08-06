import { createFileRoute } from "@tanstack/react-router";
import { MarketplaceWorkflowPage } from "../MarketplacePage";

export const Route = createFileRoute("/marketplace_/$id")({
  head: () => ({
    meta: [{ title: "Marketplace Workflow | Libretto" }],
  }),
  component: MarketplaceWorkflowRoute,
});

function MarketplaceWorkflowRoute() {
  const { id } = Route.useParams();
  return <MarketplaceWorkflowPage shareId={id} />;
}
