import { createFileRoute } from "@tanstack/react-router";
import { OpenWorkflowPage } from "../OpenWorkflowsPage";

export const Route = createFileRoute("/open-workflows_/$id")({
  head: () => ({
    meta: [{ title: "Open workflow | Libretto" }],
  }),
  component: OpenWorkflowRoute,
});

function OpenWorkflowRoute() {
  const { id } = Route.useParams();
  return <OpenWorkflowPage shareId={id} />;
}
