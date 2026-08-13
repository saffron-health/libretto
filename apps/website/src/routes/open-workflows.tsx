import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/open-workflows")({
  beforeLoad: () => {
    throw redirect({ to: "/hosted-workflows" });
  },
});
