import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard_/cloud-browsers")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/$section",
      params: { section: "workflow_runs" },
    });
  },
});
