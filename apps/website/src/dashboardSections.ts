/**
 * The dashboard's sections, in one React-free module so vite.config.ts can
 * import it for the prerender list. A section listed here but missing from
 * that list is served as a Vercel 404 — the router's fallback redirect never
 * runs, because there is no prerendered HTML to load.
 */
export const dashboardSections = [
  "workflows",
  "schedules",
  "workflow_runs",
  "browser_sessions",
  "connected_repos",
  "users",
  "settings",
  "secrets",
  "phone_numbers",
  "api_keys",
  "billing",
] as const;

export type DashboardSection = (typeof dashboardSections)[number];

/** Paths the build must prerender, derived so the two cannot drift. */
export const dashboardPrerenderPaths = [
  "/dashboard",
  ...dashboardSections.map((section) => `/dashboard/${section}`),
];
