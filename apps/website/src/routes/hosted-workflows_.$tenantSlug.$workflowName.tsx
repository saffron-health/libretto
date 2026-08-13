import { createFileRoute } from "@tanstack/react-router";
import { HostedWorkflowPage } from "../HostedWorkflowsPage";

export const Route = createFileRoute(
  "/hosted-workflows_/$tenantSlug/$workflowName",
)({
  head: () => ({
    meta: [{ title: "Hosted workflow | Libretto" }],
  }),
  component: HostedWorkflowRoute,
});

function HostedWorkflowRoute() {
  const { tenantSlug, workflowName } = Route.useParams();
  return (
    <HostedWorkflowPage tenantSlug={tenantSlug} workflowName={workflowName} />
  );
}
