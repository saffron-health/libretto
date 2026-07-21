import { createFileRoute } from "@tanstack/react-router";
import { CloudBrowsersDashboardPage } from "../DashboardPage";

export const Route = createFileRoute("/dashboard_/cloud-browsers")({
  head: () => ({
    meta: [
      { title: "Cloud Browsers | Libretto" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CloudBrowsersDashboardPage,
});
