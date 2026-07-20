import { createFileRoute } from "@tanstack/react-router";
import { CloudBrowsersDashboardPage } from "../CloudBrowsersDashboardPage";

export const Route = createFileRoute("/dashboard_/cloud-browsers")({
  component: CloudBrowsersDashboardPage,
});
