import { createFileRoute } from "@tanstack/react-router";
import { OpenWorkflowsPage } from "../OpenWorkflowsPage";

export const Route = createFileRoute("/open-workflows")({
  head: () => ({
    meta: [
      { title: "Open source workflows | Libretto" },
      {
        name: "description",
        content: "Add reusable browser workflows to your Libretto account.",
      },
    ],
  }),
  component: OpenWorkflowsPage,
});
