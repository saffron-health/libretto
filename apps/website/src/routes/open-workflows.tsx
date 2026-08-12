import { createFileRoute } from "@tanstack/react-router";
import { OpenWorkflowsPage } from "../OpenWorkflowsPage";

export const Route = createFileRoute("/open-workflows")({
  head: () => ({
    meta: [
      { title: "Open Source Workflows | Libretto" },
      {
        name: "description",
        content:
          "Browse shared Libretto workflow source, connect secrets, and deploy a private copy.",
      },
    ],
  }),
  component: OpenWorkflowsPage,
});
