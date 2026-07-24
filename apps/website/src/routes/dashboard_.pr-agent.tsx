import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard_/pr-agent")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/$section",
      params: { section: "connected_repos" },
    });
  },
});
