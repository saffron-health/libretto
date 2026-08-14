import { createFileRoute } from "@tanstack/react-router";
import { HostedWorkflowsPage } from "../HostedWorkflowsPage";

export const Route = createFileRoute("/hosted-workflows")({
  head: () => ({
    meta: [
      { title: "Hosted Workflow APIs | Libretto" },
      {
        name: "description",
        content:
          "Browse public Libretto hosted workflow APIs and call them with your own API key.",
      },
    ],
  }),
  component: HostedWorkflowsPage,
});
