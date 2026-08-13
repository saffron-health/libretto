import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { publicCloudGet } from "../cloudApi";

export const Route = createFileRoute("/open-workflows_/$id")({
  head: () => ({
    meta: [{ title: "Open source workflow | Libretto" }],
  }),
  component: OpenWorkflowRoute,
});

function OpenWorkflowRoute() {
  const { id } = Route.useParams();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    publicCloudGet<{
      publisher_slug: string | null;
      workflow_name: string;
    }>(`/open-workflows/${encodeURIComponent(id)}/data`)
      .then((workflow) => {
        if (!workflow.publisher_slug) {
          throw new Error("This workflow does not have a public publisher slug.");
        }
        window.location.replace(
          `/hosted-workflows/${encodeURIComponent(workflow.publisher_slug)}/${encodeURIComponent(workflow.workflow_name)}`,
        );
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Could not find this workflow."),
      );
  }, [id]);
  return <p className="pt-24 text-center text-sm text-muted">{error ?? "Opening published workflow…"}</p>;
}
