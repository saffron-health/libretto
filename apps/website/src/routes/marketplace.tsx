import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/marketplace")({
  beforeLoad: () => {
    throw redirect({
      to: "/open-workflows",
    });
  },
});
