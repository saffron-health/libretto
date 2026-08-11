import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDetailPage } from "../WorkflowDetailPage";

export const Route = createFileRoute("/dashboard_/workflows_/$workflow")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.workflow} | Libretto` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: WorkflowPage,
});

function WorkflowPage() {
  const { workflow } = Route.useParams();
  return <WorkflowDetailPage workflow={workflow} />;
}
