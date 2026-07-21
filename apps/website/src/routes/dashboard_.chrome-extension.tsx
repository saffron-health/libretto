import { createFileRoute } from "@tanstack/react-router";
import { ChromeExtensionDashboardPage } from "../ChromeExtensionDashboardPage";

export const Route = createFileRoute("/dashboard_/chrome-extension")({
  head: () => ({
    meta: [
      { title: "Chrome automations | Libretto" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ChromeExtensionDashboardPage,
});
