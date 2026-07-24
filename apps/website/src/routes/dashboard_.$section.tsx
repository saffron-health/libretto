import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  AuthenticatedDashboardPage,
  dashboardSections,
  type DashboardSection,
} from "../AuthenticatedDashboardPage";

function isDashboardSection(value: string): value is DashboardSection {
  return dashboardSections.some((section) => section === value);
}

export const Route = createFileRoute("/dashboard_/$section")({
  beforeLoad: ({ params }) => {
    if (!isDashboardSection(params.section)) {
      throw redirect({
        to: "/dashboard/$section",
        params: { section: "workflows" },
      });
    }
  },
  head: ({ params }) => ({
    meta: [
      {
        title: `${params.section.replaceAll("_", " ")} | Libretto`,
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DashboardSectionPage,
});

function DashboardSectionPage() {
  const { section } = Route.useParams();
  if (!isDashboardSection(section)) return null;
  return <AuthenticatedDashboardPage section={section} />;
}
