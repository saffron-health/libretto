import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/marketplace_/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/open-workflows/$id",
      params: { id: params.id },
    });
  },
});
