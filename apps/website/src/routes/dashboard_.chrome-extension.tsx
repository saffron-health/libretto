import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard_/chrome-extension")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/$section",
      params: { section: "workflows" },
    });
  },
});
