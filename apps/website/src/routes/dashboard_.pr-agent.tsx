import { createFileRoute } from "@tanstack/react-router";
import { PrAgentDashboardPage } from "../PrAgentDashboardPage";

export const Route = createFileRoute("/dashboard_/pr-agent")({
  head: () => ({
    meta: [
      { title: "Debug Agents | Libretto" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PrAgentDashboardPage,
});
