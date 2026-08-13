import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { LibrettoLogoAndName } from "./brand";
import {
  authPost,
  getAuthStatus,
  getCloudSession,
  orpcCall,
  type CloudSession,
} from "./cloudApi";
import { InstallSnippet } from "./components/InstallSnippet";
import { GitHubIcon } from "./icons";
import { DEBUGGER_PROMPT, GITHUB_APP_INSTALL_URL } from "./prAgentSetup";
import type { DashboardSection } from "./dashboardSections";

const CLOUD_SETUP_PROMPT =
  "Fetch and follow https://libretto.sh/cloud.md to set up Libretto Cloud hosted browsers for this project.";

export { dashboardSections } from "./dashboardSections";
export type { DashboardSection } from "./dashboardSections";

interface NavItem {
  id: DashboardSection;
  label: string;
  icon: ReactNode;
}

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      {children}
    </svg>
  );
}

const navItems: NavItem[] = [
  {
    id: "workflows",
    label: "Workflows",
    icon: (
      <NavIcon>
        <path d="M4 4h12v4H4zM4 12h12v4H4z" />
        <path d="M7 8v4" />
      </NavIcon>
    ),
  },
  {
    id: "schedules",
    label: "Schedules",
    icon: (
      <NavIcon>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4l2.5 1.5" />
      </NavIcon>
    ),
  },
  {
    id: "workflow_runs",
    label: "Workflow runs",
    icon: (
      <NavIcon>
        <path d="m6.5 4.5 8 5.5-8 5.5Z" />
      </NavIcon>
    ),
  },
  {
    id: "browser_sessions",
    label: "Browser sessions",
    icon: (
      <NavIcon>
        <rect x="2.5" y="4" width="15" height="12" rx="2" />
        <path d="M2.5 7.5h15M5 5.8h.1M7 5.8h.1" />
      </NavIcon>
    ),
  },
  {
    id: "connected_repos",
    label: "Self-Healing Playwright",
    icon: (
      <NavIcon>
        <circle cx="6" cy="5" r="1.5" />
        <circle cx="14" cy="7" r="1.5" />
        <circle cx="6" cy="15" r="1.5" />
        <path d="M6 6.5v7M7.5 8.5h3A3.5 3.5 0 0 0 14 5" />
      </NavIcon>
    ),
  },
  {
    id: "users",
    label: "Users",
    icon: (
      <NavIcon>
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="14" cy="8" r="2" />
        <path d="M2.5 15c.5-2.6 2-4 4.5-4s4 1.4 4.5 4M12 12c2.8-.2 4.5.8 5 3" />
      </NavIcon>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <NavIcon>
        <path d="M8.58 1.92L11.42 1.92L11.68 4.14L12.96 4.66L14.70 3.28L16.72 5.30L15.34 7.04L15.86 8.32L18.08 8.58L18.08 11.42L15.86 11.68L15.34 12.96L16.72 14.70L14.70 16.72L12.96 15.34L11.68 15.86L11.42 18.08L8.58 18.08L8.32 15.86L7.04 15.34L5.30 16.72L3.28 14.70L4.66 12.96L4.14 11.68L1.92 11.42L1.92 8.58L4.14 8.32L4.66 7.04L3.28 5.30L5.30 3.28L7.04 4.66L8.32 4.14Z" />
        <circle cx="10" cy="10" r="2.6" />
      </NavIcon>
    ),
  },
  {
    id: "secrets",
    label: "Secrets",
    icon: (
      <NavIcon>
        <rect x="4" y="8" width="12" height="9" rx="2" />
        <path d="M7 8V6a3 3 0 0 1 6 0v2M10 12v2" />
      </NavIcon>
    ),
  },
  {
    id: "phone_numbers",
    label: "Phone numbers",
    icon: (
      <NavIcon>
        <rect x="5" y="2.5" width="10" height="15" rx="2" />
        <path d="M8 14.5h4M10 5v1" />
      </NavIcon>
    ),
  },
  {
    id: "api_keys",
    label: "API keys",
    icon: (
      <NavIcon>
        <circle cx="7" cy="10" r="3" />
        <path d="M10 10h7M14 10v2M16.5 10v2" />
      </NavIcon>
    ),
  },
  {
    id: "billing",
    label: "Billing",
    icon: (
      <NavIcon>
        <rect x="2.5" y="5" width="15" height="10" rx="2" />
        <path d="M2.5 8h15M6 12h2" />
      </NavIcon>
    ),
  },
];

const accountSectionOrder: DashboardSection[] = [
  "users",
  "settings",
  "billing",
  "secrets",
  "phone_numbers",
  "api_keys",
];
const primaryNavItems = navItems.filter(
  (item) => !accountSectionOrder.includes(item.id),
);
const accountNavItems = navItems
  .filter((item) => accountSectionOrder.includes(item.id))
  .sort(
    (left, right) =>
      accountSectionOrder.indexOf(left.id) -
      accountSectionOrder.indexOf(right.id),
  );

const sectionMeta: Record<
  DashboardSection,
  { title: string; description: string }
> = {
  workflows: {
    title: "Workflows",
    description: "Saved browser automations that are ready to run.",
  },
  schedules: {
    title: "Schedules",
    description: "Recurring workflows that run automatically in the cloud.",
  },
  workflow_runs: {
    title: "Workflow runs",
    description: "A history of workflow executions and their results.",
  },
  browser_sessions: {
    title: "Browser sessions",
    description: "Browsers opened for local tasks, workflow builds, and runs.",
  },
  connected_repos: {
    title: "Self-Healing Playwright",
    description: "GitHub repositories where Libretto can open scoped fixes.",
  },
  users: {
    title: "Users",
    description: "People with access to your Libretto workspace.",
  },
  settings: {
    title: "Settings",
    description: "Workspace-wide controls for Libretto features.",
  },
  secrets: {
    title: "Secrets",
    description:
      "Encrypted values available to workflows without exposing them in code.",
  },
  phone_numbers: {
    title: "Phone numbers",
    description:
      "SMS inbox numbers for portal OTP. Prefer one number per portal, and register the full phone number (with country code, like +15551234567) on the portal account.",
  },
  api_keys: {
    title: "API keys",
    description: "Keys used by the Libretto CLI and programmatic workflows.",
  },
  billing: {
    title: "Billing",
    description: "Your current plan, automation usage, and renewal details.",
  },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  const success = [
    "ready",
    "completed",
    "closed",
    "linked",
    "verified",
    "active",
  ].includes(status);
  const failed = ["failed", "cancelled", "unknown"].includes(status);
  const classes = success
    ? "border-accent/30 bg-green-9/10 text-accent-bright"
    : failed
      ? "border-red-400/30 bg-red-500/10 text-red-200"
      : "border-amber/30 bg-amber/10 text-amber-bright";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${classes}`}
    >
      {titleCase(status)}
    </span>
  );
}

function EmptyTable({ message }: { message: string }) {
  return (
    <div className="border-t border-rule px-5 py-16 text-center text-sm text-muted">
      {message}
    </div>
  );
}

function CloudSetupEmptyTable({
  title,
  action,
  fathomEvent,
}: {
  title: string;
  action: string;
  fathomEvent: string;
}) {
  return (
    <div className="border-t border-rule px-5 py-12 text-center">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-[620px] text-sm leading-6 text-muted">
        <a
          href="/dashboard/api_keys"
          className="text-accent-bright underline decoration-accent/50 underline-offset-4 hover:text-ink"
        >
          Create an API key
        </a>
        , then copy this prompt into your coding agent to set up Libretto Cloud
        and {action}.
      </p>
      <div className="mt-5 flex justify-center">
        <InstallSnippet
          prompt={CLOUD_SETUP_PROMPT}
          fathomEvent={fathomEvent}
        />
      </div>
    </div>
  );
}

function PrAgentSetupEmptyTable() {
  return (
    <div className="border-t border-rule px-5 py-12 text-center">
      <h3 className="text-sm font-medium text-ink">
        No repositories connected yet.
      </h3>
      <p className="mx-auto mt-2 max-w-[660px] text-sm leading-6 text-muted">
        <a
          href="/dashboard/api_keys"
          className="text-accent-bright underline decoration-accent/50 underline-offset-4 hover:text-ink"
        >
          Create an API key
        </a>
        , then copy this prompt into your coding agent to add the PR agent to
        your Playwright project.
      </p>
      <div className="mt-5 flex justify-center">
        <InstallSnippet
          prompt={DEBUGGER_PROMPT}
          fathomEvent="Empty connected repos copy PR agent prompt click"
        />
      </div>
      <p className="mx-auto mt-4 max-w-[660px] text-sm leading-6 text-muted">
        Once the PR agent is set up, finish by{" "}
        <a
          href={GITHUB_APP_INSTALL_URL}
          className="text-accent-bright underline decoration-accent/50 underline-offset-4 hover:text-ink"
        >
          connecting your repositories to Libretto
        </a>
        .
      </p>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="border-t border-rule px-5 py-16 text-center text-sm text-muted">
      Loading…
    </div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-panel/65 shadow-[0_12px_40px_rgba(0,0,0,0.16)]">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const thClass =
  "whitespace-nowrap border-b border-rule bg-panel-hi/65 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted";
const tdClass = "border-b border-rule px-5 py-4 text-sm text-muted";
const tableClass =
  "w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0";
const tableActionClass =
  "inline-flex h-7 items-center rounded-md border border-rule px-2.5 text-xs text-muted no-underline transition-colors hover:border-accent/40 hover:text-ink";
const tableDangerActionClass =
  "inline-flex h-7 items-center rounded-md border border-red-400/25 px-2.5 text-xs text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60";
const tableSelectClass =
  "-ml-2 h-7 max-w-full rounded-md border border-transparent bg-transparent py-0 pl-2 pr-7 text-sm text-muted outline-none transition-colors hover:border-rule focus:border-accent/45 disabled:opacity-60";
const tableSelectStaticClass = "inline-flex h-7 items-center text-sm text-muted";

function ProfileMenu({
  session,
  placement,
}: {
  session: CloudSession;
  placement: "header" | "sidebar";
}) {
  async function signOut() {
    try {
      await authPost("/api/auth/sign-out", {});
    } finally {
      window.location.assign("/");
    }
  }

  const sidebar = placement === "sidebar";
  return (
    <details className={`relative ${sidebar ? "w-full" : ""}`}>
      <summary
        className={`cursor-pointer list-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-details-marker]:hidden ${
          sidebar
            ? "flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-panel-hi"
            : "grid size-9 place-items-center rounded-full border border-accent/35 bg-green-9/10 text-sm font-medium text-accent-bright hover:bg-green-9/20"
        }`}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-accent/35 bg-green-9/10 font-mono text-xs text-accent-bright">
          {session.user.email.slice(0, 1).toUpperCase()}
        </span>
        {sidebar && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-xs text-muted">Profile</span>
              <span className="block truncate text-xs text-ink">
                {session.user.email}
              </span>
            </span>
          </>
        )}
      </summary>
      <div
        className={`absolute z-30 w-64 rounded-lg border border-rule bg-panel p-2 shadow-2xl shadow-black/45 ${
          sidebar ? "bottom-14 left-0" : "right-0 top-12"
        }`}
      >
        <div className="border-b border-rule px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted">
            Profile
          </p>
          <p className="mt-1 truncate text-sm text-ink">{session.user.email}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-panel-hi hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </details>
  );
}

export function DashboardShell({
  section,
  session,
  action,
  title,
  description,
  children,
}: {
  section: DashboardSection;
  session: CloudSession;
  action?: ReactNode;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const meta = sectionMeta[section];
  return (
    <div className="min-h-screen bg-bg text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[280px] flex-col border-r border-rule bg-panel/95 md:flex">
        <div className="flex h-16 items-center border-b border-rule px-5">
          <a href="/" className="text-ink no-underline">
            <LibrettoLogoAndName />
          </a>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Automations">
          {primaryNavItems.map((item) => (
            <a
              key={item.id}
              href={`/dashboard/${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
              className="flex h-10 items-center gap-3 whitespace-nowrap rounded-md border border-transparent px-3 text-sm text-muted no-underline transition-colors hover:bg-panel-hi hover:text-ink aria-[current=page]:border-accent/35 aria-[current=page]:bg-green-3/35 aria-[current=page]:text-accent-bright"
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <nav
          className="space-y-1 border-t border-rule px-3 py-3"
          aria-label="Account"
        >
          {accountNavItems.map((item) => (
            <a
              key={item.id}
              href={`/dashboard/${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
              className="flex h-10 items-center gap-3 whitespace-nowrap rounded-md border border-transparent px-3 text-sm text-muted no-underline transition-colors hover:bg-panel-hi hover:text-ink aria-[current=page]:border-accent/35 aria-[current=page]:bg-green-3/35 aria-[current=page]:text-accent-bright"
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-rule p-3">
          <ProfileMenu session={session} placement="sidebar" />
        </div>
      </aside>

      <div className="md:pl-[280px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-rule bg-bg/90 px-4 backdrop-blur md:justify-end md:px-7">
          <a href="/" className="text-ink no-underline md:hidden">
            <LibrettoLogoAndName />
          </a>
          <div className="md:hidden">
            <ProfileMenu session={session} placement="header" />
          </div>
        </header>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto border-b border-rule bg-panel/40 px-3 py-2 md:hidden">
          {[...primaryNavItems, ...accountNavItems].map((item) => (
            <a
              key={item.id}
              href={`/dashboard/${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
              className="whitespace-nowrap rounded-md px-3 py-2 text-xs text-muted no-underline aria-[current=page]:bg-green-3/40 aria-[current=page]:text-accent-bright"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-[1320px] px-4 py-8 md:px-8 md:py-10">
          <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-serif text-[36px] font-[300] tracking-[-0.025em] md:text-[44px]">
                {title ?? meta.title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                {description ?? meta.description}
              </p>
            </div>
            {action}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

interface WorkflowRow {
  name: string;
  deployment_id: string;
  deployment_status: "building" | "ready" | "failed";
  created_at: string;
  updated_at: string;
}

interface WorkflowBuildRow {
  build_id: string;
  status: string;
  workflow_name: string | null;
  created_at: string;
  updated_at: string;
}

function WorkflowsTable() {
  const [rows, setRows] = useState<Array<
    WorkflowRow | WorkflowBuildRow
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orpcCall<{
      deployed_workflows?: WorkflowRow[];
      in_progress_builds?: WorkflowBuildRow[];
    }>("/v1/workflows/list")
      .then((result) =>
        setRows([
          ...(result.in_progress_builds ?? []),
          ...(result.deployed_workflows ?? []),
        ]),
      )
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load workflows.",
        ),
      );
  }, []);
  return (
    <TableShell>
      <table className={`${tableClass} min-w-[760px]`}>
        <thead>
          <tr>
            <th className={thClass}>Workflow</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Created</th>
            <th className={thClass}>Updated</th>
            <th className={thClass}>ID</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => {
            const build = "build_id" in row;
            return (
              <tr
                key={build ? row.build_id : row.deployment_id}
                className="hover:bg-panel-hi/35"
              >
                <td className={`${tdClass} font-medium text-ink`}>
                  {build ? (
                    row.workflow_name || "New workflow"
                  ) : (
                    <a
                      href={`/dashboard/workflows/${encodeURIComponent(row.name)}`}
                      className="text-ink underline decoration-rule underline-offset-4 hover:decoration-accent"
                    >
                      {row.name}
                    </a>
                  )}
                </td>
                <td className={tdClass}>
                  <StatusBadge
                    status={build ? row.status : row.deployment_status}
                  />
                </td>
                <td className={tdClass}>{formatDate(row.created_at)}</td>
                <td className={tdClass}>{formatDate(row.updated_at)}</td>
                <td
                  className={`${tdClass} max-w-[210px] truncate font-mono text-xs`}
                >
                  {build ? row.build_id : row.deployment_id}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows === null && !error && <LoadingTable />}
      {rows?.length === 0 && (
        <CloudSetupEmptyTable
          title="No workflows yet."
          action="create your first cloud workflow"
          fathomEvent="Empty workflows copy cloud setup prompt click"
        />
      )}
      {error && <EmptyTable message={error} />}
    </TableShell>
  );
}

interface ScheduleRow {
  id: string;
  workflow: string;
  cron_expr: string;
  timezone: string;
  enabled: boolean;
  next_fire_at: string;
  last_fire_at: string | null;
  last_error: string | null;
}

function SchedulesTable() {
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    const result = await orpcCall<{ schedules: ScheduleRow[] }>(
      "/v1/schedules/list",
      { limit: 100 },
    );
    setRows(result.schedules);
  }
  useEffect(() => {
    refresh().catch((err) =>
      setError(
        err instanceof Error ? err.message : "Could not load schedules.",
      ),
    );
  }, []);
  async function toggle(row: ScheduleRow) {
    setError(null);
    try {
      await orpcCall("/v1/schedules/update", {
        id: row.id,
        enabled: !row.enabled,
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update schedule.",
      );
    }
  }
  async function remove(row: ScheduleRow) {
    if (!window.confirm(`Delete the schedule for ${row.workflow}?`)) return;
    setError(null);
    try {
      await orpcCall("/v1/schedules/delete", { id: row.id });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete schedule.",
      );
    }
  }
  return (
    <TableShell>
      <table className={`${tableClass} min-w-[900px]`}>
        <thead>
          <tr>
            <th className={thClass}>Workflow</th>
            <th className={thClass}>Schedule</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Next run</th>
            <th className={thClass}>Last run</th>
            <th className={thClass}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={row.id} className="hover:bg-panel-hi/35">
              <td className={`${tdClass} font-medium text-ink`}>
                {row.workflow}
              </td>
              <td className={tdClass}>
                <span className="font-mono text-xs text-ink">
                  {row.cron_expr}
                </span>
                <span className="ml-2 text-xs">{row.timezone}</span>
              </td>
              <td className={tdClass}>
                {row.last_error ? (
                  <StatusBadge status="failed" />
                ) : (
                  <StatusBadge status={row.enabled ? "scheduled" : "paused"} />
                )}
              </td>
              <td className={tdClass}>{formatDate(row.next_fire_at)}</td>
              <td className={tdClass}>{formatDate(row.last_fire_at)}</td>
              <td className={tdClass}>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(row)}
                    className={tableActionClass}
                  >
                    {row.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    className={tableDangerActionClass}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null && !error && <LoadingTable />}
      {rows?.length === 0 && (
        <CloudSetupEmptyTable
          title="No schedules yet."
          action="create and schedule a cloud workflow"
          fathomEvent="Empty schedules copy cloud setup prompt click"
        />
      )}
      {error && <EmptyTable message={error} />}
    </TableShell>
  );
}

interface JobRow {
  job_id: string;
  workflow: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_class: string | null;
}
function WorkflowRunsTable() {
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orpcCall<{ jobs: JobRow[] }>("/v1/dashboard/jobs", { limit: 100 })
      .then((r) => setRows(r.jobs))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load workflow runs.",
        ),
      );
  }, []);
  return (
    <TableShell>
      <table className={`${tableClass} min-w-[850px]`}>
        <thead>
          <tr>
            <th className={thClass}>Workflow</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Started</th>
            <th className={thClass}>Runtime</th>
            <th className={thClass}>Result</th>
            <th className={thClass}>Run ID</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={row.job_id} className="hover:bg-panel-hi/35">
              <td className={`${tdClass} font-medium text-ink`}>
                {row.workflow || "Untitled workflow"}
              </td>
              <td className={tdClass}>
                <StatusBadge status={row.status} />
              </td>
              <td className={tdClass}>
                {formatDate(row.started_at ?? row.created_at)}
              </td>
              <td className={tdClass}>
                {formatDuration(
                  row.started_at && row.completed_at
                    ? new Date(row.completed_at).getTime() -
                        new Date(row.started_at).getTime()
                    : null,
                )}
              </td>
              <td className={tdClass}>
                {row.failure_class ||
                  (row.status === "completed" ? "Completed" : "—")}
              </td>
              <td
                className={`${tdClass} max-w-[190px] truncate font-mono text-xs`}
              >
                {row.job_id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null && !error && <LoadingTable />}
      {rows?.length === 0 && (
        <CloudSetupEmptyTable
          title="No workflow runs yet."
          action="create and run a cloud workflow"
          fathomEvent="Empty workflow runs copy cloud setup prompt click"
        />
      )}
      {error && <EmptyTable message={error} />}
    </TableShell>
  );
}

interface SessionRow {
  session_id: string;
  browser_provider: string | null;
  status: string;
  source: string | null;
  owner_type: string | null;
  live_view_url: string | null;
  started_at: string;
  duration_ms: number | null;
}
function BrowserSessionsTable() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orpcCall<{ sessions: SessionRow[] }>("/v1/dashboard/sessions", {
      limit: 100,
    })
      .then((r) => setRows(r.sessions))
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "Could not load browser sessions.",
        ),
      );
  }, []);
  return (
    <TableShell>
      <table className={`${tableClass} min-w-[850px]`}>
        <thead>
          <tr>
            <th className={thClass}>Session</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Provider</th>
            <th className={thClass}>Started</th>
            <th className={thClass}>Runtime</th>
            <th className={thClass}>Live view</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={row.session_id} className="hover:bg-panel-hi/35">
              <td
                className={`${tdClass} max-w-[220px] truncate font-mono text-xs text-ink`}
              >
                {row.session_id}
              </td>
              <td className={tdClass}>
                <StatusBadge status={row.status} />
              </td>
              <td className={tdClass}>
                {titleCase(row.source ?? row.owner_type ?? "browser")}
              </td>
              <td className={tdClass}>{row.browser_provider || "—"}</td>
              <td className={tdClass}>{formatDate(row.started_at)}</td>
              <td className={tdClass}>{formatDuration(row.duration_ms)}</td>
              <td className={tdClass}>
                {row.live_view_url ? (
                  <a
                    href={row.live_view_url}
                    target="_blank"
                    rel="noreferrer"
                    className={tableActionClass}
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs text-muted/50">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null && !error && <LoadingTable />}
      {rows?.length === 0 && (
        <CloudSetupEmptyTable
          title="No browser sessions yet."
          action="start a hosted browser session"
          fathomEvent="Empty browser sessions copy cloud setup prompt click"
        />
      )}
      {error && <EmptyTable message={error} />}
    </TableShell>
  );
}

interface RepoRow {
  id: string;
  full_name: string;
  private: boolean;
  linked_at: string;
  account_login: string;
}
function ConnectedReposTable({
  onHasRepositoriesChange,
}: {
  onHasRepositoriesChange: (hasRepositories: boolean) => void;
}) {
  const [rows, setRows] = useState<RepoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orpcCall<{ repositories: RepoRow[] }>("/v1/github/listLinkedRepositories")
      .then((r) => {
        setRows(r.repositories);
        onHasRepositoriesChange(r.repositories.length > 0);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load repositories.",
        ),
      );
  }, [onHasRepositoriesChange]);
  return (
    <TableShell>
      <table className={`${tableClass} min-w-[700px]`}>
        <thead>
          <tr>
            <th className={thClass}>Repository</th>
            <th className={thClass}>Access</th>
            <th className={thClass}>GitHub account</th>
            <th className={thClass}>Connected</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={row.id} className="hover:bg-panel-hi/35">
              <td className={`${tdClass} font-medium text-ink`}>
                <span className="flex items-center gap-2">
                  <GitHubIcon className="size-4 text-accent-bright" />
                  {row.full_name}
                </span>
              </td>
              <td className={tdClass}>{row.private ? "Private" : "Public"}</td>
              <td className={tdClass}>{row.account_login}</td>
              <td className={tdClass}>{formatDate(row.linked_at)}</td>
              <td className={tdClass}>
                <StatusBadge status="linked" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null && !error && <LoadingTable />}
      {rows?.length === 0 && <PrAgentSetupEmptyTable />}
      {error && <EmptyTable message={error} />}
    </TableShell>
  );
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  email_verified: boolean;
  created_at: string;
}
interface UsersResponse {
  organization: { name: string };
  users: UserRow[];
}
function UsersTable({
  session,
  showInvite,
  onCloseInvite,
}: {
  session: CloudSession;
  showInvite: boolean;
  onCloseInvite: () => void;
}) {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function refresh() {
    setData(await orpcCall<UsersResponse>("/v1/dashboard/users"));
  }
  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load users."),
    );
  }, []);
  const currentUser = data?.users.find((user) => user.id === session.user.id);
  const canManage = currentUser?.role === "owner";
  const isSoleMember = data?.users.length === 1;
  const ownerCount =
    data?.users.filter((user) => user.role === "owner").length ?? 0;
  const canDeleteAccount =
    canManage && (isSoleMember || ownerCount > 1);
  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    try {
      await orpcCall("/v1/dashboard/inviteUser", { email, role: "member" });
      setEmail("");
      setNotice(`Invite sent to ${email}.`);
      onCloseInvite();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setBusy(null);
    }
  }
  async function updateRole(user: UserRow, role: string) {
    setBusy(user.id);
    setError(null);
    try {
      await orpcCall("/v1/dashboard/updateUserRole", {
        userId: user.id,
        role,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
    } finally {
      setBusy(null);
    }
  }
  async function remove(user: UserRow) {
    if (!window.confirm(`Remove ${user.email} from this workspace?`)) return;
    setBusy(user.id);
    setError(null);
    try {
      await orpcCall("/v1/dashboard/removeUser", { userId: user.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove user.");
    } finally {
      setBusy(null);
    }
  }
  async function deleteAccount() {
    const deletingWorkspace = isSoleMember;
    const confirmed = window.confirm(
      deletingWorkspace
        ? `Permanently delete your account and the ${data?.organization.name ?? "current"} workspace, including its data, API keys, and billing?`
        : "Permanently delete your Libretto Cloud account, sign-in methods, sessions, API keys, and workspace membership?",
    );
    if (!confirmed) return;

    setBusy("delete-account");
    setError(null);
    try {
      await orpcCall("/v1/dashboard/deleteAccount");
      window.location.assign("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete account.",
      );
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      {showInvite && (
        <form
          onSubmit={invite}
          className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-green-3/20 p-4 sm:flex-row sm:items-end"
        >
          <label className="flex-1">
            <span className="mb-2 block text-xs uppercase text-muted">
              Email address
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
              className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={busy === "invite"}
            className="libretto-button libretto-button--default h-10"
          >
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
          <button
            type="button"
            onClick={onCloseInvite}
            className="h-10 px-3 text-sm text-muted"
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-accent/30 bg-green-9/10 px-4 py-3 text-sm text-accent-bright">
          {notice}
        </p>
      )}
      <TableShell>
        <table className={`${tableClass} min-w-[760px]`}>
          <thead>
            <tr>
              <th className={thClass}>User</th>
              <th className={thClass}>Role</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Joined</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((user) => (
              <tr key={user.id} className="hover:bg-panel-hi/35">
                <td className={tdClass}>
                  <p className="font-medium text-ink">
                    {user.name || user.email.split("@")[0]}
                  </p>
                  <p className="mt-1 text-xs">
                    {user.email}
                    {user.id === session.user.id ? " · you" : ""}
                  </p>
                </td>
                <td className={tdClass}>
                  {canManage && user.id !== session.user.id ? (
                    <select
                      value={user.role}
                      disabled={busy === user.id}
                      onChange={(event) =>
                        void updateRole(user, event.target.value)
                      }
                      className={tableSelectClass}
                      aria-label={`Role for ${user.email}`}
                    >
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </select>
                  ) : (
                    <span className={tableSelectStaticClass}>
                      {titleCase(user.role)}
                    </span>
                  )}
                </td>
                <td className={tdClass}>
                  <StatusBadge
                    status={user.email_verified ? "verified" : "pending"}
                  />
                </td>
                <td className={tdClass}>{formatDate(user.created_at)}</td>
                <td className={tdClass}>
                  {user.id !== session.user.id && canManage ? (
                    <button
                      type="button"
                      disabled={busy === user.id}
                      onClick={() => void remove(user)}
                      className={tableDangerActionClass}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data === null && !error && <LoadingTable />}
        {data?.users.length === 0 && <EmptyTable message="No users yet." />}
      </TableShell>
      {data && canDeleteAccount && (
        <details className="group text-xs text-muted">
          <summary className="w-fit cursor-pointer select-none hover:text-ink">
            Account options
          </summary>
          <div className="mt-3 flex flex-col gap-4 rounded-lg border border-rule/80 bg-panel/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl leading-5">
              {isSoleMember
                ? "Delete your account and this workspace, including its data, API keys, and billing."
                : "Delete your account, sign-in methods, sessions, API keys, and workspace membership."}
            </p>
            <button
              type="button"
              disabled={busy === "delete-account"}
              onClick={() => void deleteAccount()}
              className="h-8 shrink-0 self-start rounded border border-red-400/20 px-3 text-[11px] text-red-200/75 hover:border-red-300/40 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
            >
              {busy === "delete-account"
                ? "Deleting…"
                : isSoleMember
                  ? "Delete account and workspace"
                  : "Delete account"}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

interface SecretRow {
  credential_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface SecretMutationResponse {
  success: boolean;
  message: string;
}

function SecretValueField({
  value,
  onChange,
  visible,
  onToggleVisibility,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        autoFocus={autoFocus}
        className="h-10 w-full rounded-md border border-rule bg-bg px-3 pr-11 text-sm outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        aria-label={visible ? "Hide secret value" : "Show secret value"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        >
          <path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z" />
          <circle cx="10" cy="10" r="2" />
          {visible && <path d="m3 3 14 14" />}
        </svg>
      </button>
    </div>
  );
}

function SecretsTable({
  showCreate,
  onCloseCreate,
}: {
  showCreate: boolean;
  onCloseCreate: () => void;
}) {
  const [rows, setRows] = useState<SecretRow[] | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<{
    row: SecretRow;
    mode: "rename" | "replace";
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [showEditValue, setShowEditValue] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const result = await orpcCall<{ secrets: SecretRow[] }>(
      "/v1/dashboard/secrets",
    );
    setRows(result.secrets);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load secrets."),
    );
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      await orpcCall("/v1/dashboard/createSecret", {
        name: name.trim(),
        value,
      });
      setName("");
      setValue("");
      setShowValue(false);
      setNotice("Secret created.");
      onCloseCreate();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create secret.");
    } finally {
      setBusy(null);
    }
  }

  function startEditing(row: SecretRow, mode: "rename" | "replace") {
    setEditing({ row, mode });
    setEditName(row.name);
    setEditValue("");
    setShowEditValue(false);
    setError(null);
    setNotice(null);
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(editing.row.credential_id);
    setError(null);
    setNotice(null);
    try {
      await orpcCall("/v1/dashboard/updateSecret", {
        id: editing.row.credential_id,
        ...(editing.mode === "rename"
          ? { name: editName.trim() }
          : { value: editValue }),
      });
      setEditing(null);
      setEditValue("");
      setShowEditValue(false);
      setNotice("Secret updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update secret.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: SecretRow) {
    if (!window.confirm(`Delete secret “${row.name}”?`)) return;
    setBusy(row.credential_id);
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<SecretMutationResponse>(
        "/v1/dashboard/deleteSecret",
        { id: row.credential_id },
      );
      if (!result.success) throw new Error(result.message);
      if (editing?.row.credential_id === row.credential_id) setEditing(null);
      setNotice("Secret deleted.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete secret.");
    } finally {
      setBusy(null);
    }
  }

  const formClass =
    "grid gap-3 rounded-xl border border-accent/25 bg-green-3/20 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end";
  const inputClass =
    "h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent";

  return (
    <div className="space-y-4">
      {showCreate && (
        <form onSubmit={create} className={formClass}>
          <label>
            <span className="mb-2 block text-xs uppercase text-muted">
              Secret name
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="STRIPE_API_KEY"
              required
              autoFocus
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs uppercase text-muted">
              Secret value
            </span>
            <SecretValueField
              value={value}
              onChange={setValue}
              visible={showValue}
              onToggleVisibility={() => setShowValue((current) => !current)}
              placeholder="Stored encrypted and never shown again"
            />
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy === "create"}
              className="libretto-button libretto-button--default h-10"
            >
              {busy === "create" ? "Saving…" : "Save secret"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowValue(false);
                onCloseCreate();
              }}
              className="h-10 px-3 text-sm text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form
          onSubmit={update}
          className="grid gap-3 rounded-xl border border-accent/25 bg-green-3/20 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        >
          <label>
            <span className="mb-2 block text-xs uppercase text-muted">
              {editing.mode === "rename" ? "Secret name" : "New secret value"}
            </span>
            {editing.mode === "rename" ? (
              <input
                type="text"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                required
                autoFocus
                className={inputClass}
              />
            ) : (
              <SecretValueField
                value={editValue}
                onChange={setEditValue}
                visible={showEditValue}
                onToggleVisibility={() =>
                  setShowEditValue((current) => !current)
                }
                placeholder="The current value will be replaced"
                autoFocus
              />
            )}
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy === editing.row.credential_id}
              className="libretto-button libretto-button--default h-10"
            >
              {busy === editing.row.credential_id
                ? "Saving…"
                : editing.mode === "rename"
                  ? "Rename secret"
                  : "Replace value"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEditValue(false);
                setEditing(null);
              }}
              className="h-10 px-3 text-sm text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-accent/25 bg-green-3/20 px-4 py-3 text-sm text-accent-bright">
          {notice}
        </p>
      )}

      <TableShell>
        <table className={`${tableClass} min-w-[720px]`}>
          <thead>
            <tr>
              <th className={thClass}>Name</th>
              <th className={thClass}>Updated</th>
              <th className={thClass}>Created</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr key={row.credential_id} className="hover:bg-panel-hi/35">
                <td className={`${tdClass} font-mono text-xs text-ink`}>
                  {row.name}
                </td>
                <td className={tdClass}>{formatDate(row.updated_at)}</td>
                <td className={tdClass}>{formatDate(row.created_at)}</td>
                <td className={tdClass}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(row, "rename")}
                      className={tableActionClass}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditing(row, "replace")}
                      className={tableActionClass}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      disabled={busy === row.credential_id}
                      onClick={() => void remove(row)}
                      className={tableDangerActionClass}
                    >
                      {busy === row.credential_id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !error && <LoadingTable />}
        {rows?.length === 0 && <EmptyTable message="No secrets yet." />}
      </TableShell>
    </div>
  );
}

interface SmsNumberRow {
  id: string;
  phone_number: string;
  label: string | null;
  status: "active" | "released";
  created_at: string;
  updated_at: string;
}

function CopyNumberButton({ phoneNumber }: { phoneNumber: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(phoneNumber).then(() => setCopied(true));
      }}
      aria-label={copied ? "Copied" : `Copy ${phoneNumber}`}
      title={copied ? "Copied" : "Copy number"}
      className="text-muted transition-colors hover:text-accent-bright"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        {copied ? (
          <path d="m4.5 10.5 3.5 3.5 7.5-8" />
        ) : (
          <>
            <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
            <path d="M12.5 4.5H5A1.5 1.5 0 0 0 3.5 6v7" />
          </>
        )}
      </svg>
    </button>
  );
}

function PhoneNumbersTable({
  showCreate,
  onCloseCreate,
}: {
  showCreate: boolean;
  onCloseCreate: () => void;
}) {
  const [rows, setRows] = useState<SmsNumberRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const result = await orpcCall<{ numbers: SmsNumberRow[] }>(
      "/v1/dashboard/smsNumbers",
    );
    setRows(result.numbers);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(
        err instanceof Error ? err.message : "Could not load phone numbers.",
      ),
    );
  }, []);

  async function provision(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<{
        success: true;
        number: SmsNumberRow;
        message: string;
      }>("/v1/dashboard/provisionSmsNumber", {
        label: label.trim() || undefined,
      });
      setLabel("");
      setNotice(
        `${result.number.phone_number} is ready. Register it as the MFA phone on the portal account.`,
      );
      onCloseCreate();
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not provision a number.",
      );
    } finally {
      setBusy(null);
    }
  }

  function startEditingLabel(row: SmsNumberRow) {
    setEditingId(row.id);
    setEditLabel(row.label ?? "");
    setError(null);
    setNotice(null);
  }

  async function saveLabel(row: SmsNumberRow) {
    const trimmed = editLabel.trim();
    setEditingId(null);
    if (trimmed === (row.label ?? "")) return;
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await orpcCall("/v1/dashboard/updateSmsNumber", {
        id: row.id,
        label: trimmed || null,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the label.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteNumber(row: SmsNumberRow) {
    if (
      !window.confirm(
        `Delete ${row.phone_number}? This releases the number for good, and any portal still texting passcodes here must be updated.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<{ success: true; message: string }>(
        "/v1/dashboard/releaseSmsNumber",
        { id: row.id },
      );
      setNotice(result.message);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the number.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {showCreate && (
        <form
          onSubmit={(event) => void provision(event)}
          className="grid gap-3 rounded-xl border border-accent/25 bg-green-3/20 p-4 md:grid-cols-[minmax(0,18rem)_auto] md:items-end"
        >
          <label>
            <span className="mb-2 block text-xs uppercase text-muted">
              Label (optional)
            </span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="uhc"
              autoFocus
              className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy === "create"}
              className="libretto-button libretto-button--default h-10"
            >
              {busy === "create" ? "Provisioning…" : "Provision number"}
            </button>
            <button
              type="button"
              onClick={onCloseCreate}
              className="h-10 px-3 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-accent/30 bg-green-3/25 px-4 py-3 text-sm text-accent-bright">
          {notice}
        </p>
      )}
      <TableShell>
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>Phone</th>
              <th className={thClass}>Label</th>
              <th className={thClass}>Created</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr key={row.id} className="hover:bg-panel-hi/35">
                <td className={tdClass}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink">
                      {row.phone_number}
                    </span>
                    <CopyNumberButton phoneNumber={row.phone_number} />
                  </div>
                </td>
                <td className={tdClass}>
                  {editingId === row.id ? (
                    <input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      onBlur={() => void saveLabel(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveLabel(row);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      placeholder="uhc"
                      aria-label={`Label for ${row.phone_number}`}
                      autoFocus
                      className="h-8 w-40 rounded-md border border-accent/40 bg-bg px-2 text-sm outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingLabel(row)}
                      title="Click to edit"
                      className="rounded-md border border-transparent px-2 py-1 text-left text-sm hover:border-rule hover:bg-panel-hi/50"
                    >
                      {busy === row.id && editingId === null
                        ? "Saving…"
                        : (row.label ?? (
                            <span className="text-muted">Add label</span>
                          ))}
                    </button>
                  )}
                </td>
                <td className={tdClass}>{formatDate(row.created_at)}</td>
                <td className={tdClass}>
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void deleteNumber(row)}
                    className="rounded-md border border-red-400/25 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-60"
                  >
                    {busy === row.id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !error && <LoadingTable />}
        {rows?.length === 0 && (
          <EmptyTable message="No SMS inbox numbers yet. Provision one per portal." />
        )}
      </TableShell>

    </div>
  );
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  enabled: boolean;
  last_request: string | null;
  expires_at: string | null;
  created_at: string;
  creator: {
    id: string;
    name: string;
    email: string;
  };
}

interface CreatedApiKey {
  id: string;
  name: string | null;
  key: string;
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  enabled: boolean;
  last_request: string | null;
  expires_at: string | null;
  created_at: string;
  creator: {
    id: string;
    name: string;
    email: string;
  };
}

interface CreatedApiKey {
  id: string;
  name: string | null;
  key: string;
}

function ApiKeysTable({
  session,
  showCreate,
  onCloseCreate,
}: {
  session: CloudSession;
  showCreate: boolean;
  onCloseCreate: () => void;
}) {
  const [rows, setRows] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const result = await orpcCall<{ api_keys: ApiKeyRow[] }>(
      "/v1/dashboard/apiKeys",
    );
    setRows(result.api_keys);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load API keys."),
    );
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const created = await authPost<CreatedApiKey>(
        "/api/auth/api-key/create",
        { name: name.trim() || "Libretto API key" },
      );
      setCreatedKey(created);
      setName("");
      onCloseCreate();
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create API key.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: ApiKeyRow) {
    if (
      !window.confirm(`Delete API key “${row.name || row.id}”?`)
    ) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      await authPost("/api/auth/api-key/delete", { keyId: row.id });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete API key.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyCreatedKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      {createdKey && (
        <div className="rounded-xl border border-accent/30 bg-green-3/25 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-accent-bright">
                API key created
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Copy this key now. It will not be shown again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreatedKey(null)}
              className="text-sm text-muted hover:text-ink"
              aria-label="Dismiss API key"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rule bg-bg p-2">
            <code className="min-w-0 flex-1 overflow-x-auto px-2 font-mono text-xs text-ink">
              {createdKey.key}
            </code>
            <button
              type="button"
              onClick={() => void copyCreatedKey()}
              className="libretto-button libretto-button--sm h-8"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={create}
          className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-green-3/20 p-4 sm:flex-row sm:items-end"
        >
          <label className="flex-1">
            <span className="mb-2 block text-xs uppercase text-muted">
              Key name
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Production automation"
              required
              autoFocus
              className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={busy === "create"}
            className="libretto-button libretto-button--default h-10"
          >
            {busy === "create" ? "Creating…" : "Create key"}
          </button>
          <button
            type="button"
            onClick={onCloseCreate}
            className="h-10 px-3 text-sm text-muted"
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <TableShell>
        <table className={`${tableClass} min-w-[820px]`}>
          <thead>
            <tr>
              <th className={thClass}>Name</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Created by</th>
              <th className={thClass}>Last used</th>
              <th className={thClass}>Created</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr key={row.id} className="hover:bg-panel-hi/35">
                <td className={`${tdClass} font-medium text-ink`}>
                  {row.name || "Unnamed key"}
                </td>
                <td className={tdClass}>
                  <StatusBadge status={row.enabled ? "active" : "disabled"} />
                </td>
                <td className={tdClass}>
                  <p className="text-sm text-ink">{row.creator.name}</p>
                  <p className="mt-1 text-xs text-muted">{row.creator.email}</p>
                </td>
                <td className={tdClass}>{formatDate(row.last_request)}</td>
                <td className={tdClass}>{formatDate(row.created_at)}</td>
                <td className={tdClass}>
                  {row.creator.id === session.user.id ? (
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void remove(row)}
                      className={tableDangerActionClass}
                    >
                      {busy === row.id ? "Deleting…" : "Delete"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted/60">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !error && <LoadingTable />}
        {rows?.length === 0 && <EmptyTable message="No API keys yet." />}
      </TableShell>
    </div>
  );
}

interface BillingResponse {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  browserHoursUsedThisPeriod: number;
  browserHoursLimit: number | null;
}

function BillingTable() {
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orpcCall<BillingResponse>("/v1/billing/subscription")
      .then(setBilling)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load billing.",
        ),
      );
  }, []);

  const usage = billing
    ? `${billing.browserHoursUsedThisPeriod.toFixed(2)} / ${billing.browserHoursLimit ?? "Unlimited"} hours`
    : "—";

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      <TableShell>
        <table className={`${tableClass} min-w-[760px]`}>
          <thead>
            <tr>
              <th className={thClass}>Plan</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Usage this period</th>
              <th className={thClass}>Renews</th>
            </tr>
          </thead>
          <tbody>
            {billing && (
              <tr>
                <td className={`${tdClass} font-medium text-ink`}>
                  {billing.plan}
                </td>
                <td className={tdClass}>
                  <StatusBadge status={billing.status} />
                </td>
                <td className={tdClass}>{usage}</td>
                <td className={tdClass}>
                  {billing.cancelAtPeriodEnd
                    ? "Cancels at period end"
                    : formatDate(billing.currentPeriodEnd)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {billing === null && !error && <LoadingTable />}
      </TableShell>
    </div>
  );
}

function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manageBilling() {
    setBusy(true);
    setError(null);
    try {
      const result = await orpcCall<{ url: string }>(
        "/v1/billing/openPlansPage",
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open billing portal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void manageBilling()}
        disabled={busy}
        className="libretto-button libretto-button--default h-10"
      >
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error && <p className="max-w-xs text-xs text-red-200">{error}</p>}
    </div>
  );
}

type CodeSharingStatus = {
  enabled: boolean;
};

type WebhookEndpoint = {
  webhook_endpoint_id: string;
  url: string;
  description?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type WebhookCreateResponse = {
  success: true;
  webhook_endpoint_id: string;
  message: string;
  signing_secret?: string;
};

function WebhookSettingsPanel() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [editing, setEditing] = useState<WebhookEndpoint | "new" | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [active, setActive] = useState(true);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const result = await orpcCall<{ webhook_endpoints: WebhookEndpoint[] }>(
      "/v1/webhooks/list",
    );
    setEndpoints(result.webhook_endpoints);
  }

  async function refreshAfterMutation() {
    try {
      await refresh();
    } catch {
      setError(
        "The change was saved, but the endpoint list could not be refreshed. Reload the page to see the latest state.",
      );
    }
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(
        err instanceof Error ? err.message : "Could not load webhook endpoints.",
      ),
    );
  }, []);

  function startCreating() {
    setEditing("new");
    setUrl("");
    setDescription("");
    setSigningSecret("");
    setActive(true);
    setError(null);
    setNotice(null);
    setGeneratedSecret(null);
  }

  function startEditing(endpoint: WebhookEndpoint) {
    setEditing(endpoint);
    setUrl(endpoint.url);
    setDescription(endpoint.description ?? "");
    setSigningSecret("");
    setActive(endpoint.active);
    setError(null);
    setNotice(null);
    setGeneratedSecret(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const id = editing === "new" ? "new" : editing.webhook_endpoint_id;
    setBusy(id);
    setError(null);
    setNotice(null);
    setGeneratedSecret(null);
    try {
      if (editing === "new") {
        const result = await orpcCall<WebhookCreateResponse>(
          "/v1/webhooks/create",
          {
            url: url.trim(),
            description: description.trim(),
            active,
          },
        );
        setGeneratedSecret(result.signing_secret ?? null);
        setNotice("Webhook endpoint added.");
      } else {
        await orpcCall("/v1/webhooks/update", {
          id: editing.webhook_endpoint_id,
          url: url.trim(),
          description: description.trim(),
          active,
          ...(signingSecret ? { signing_secret: signingSecret } : {}),
        });
        setNotice("Webhook endpoint updated.");
      }
      setEditing(null);
      setSigningSecret("");
      await refreshAfterMutation();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save webhook endpoint.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(endpoint: WebhookEndpoint) {
    if (!window.confirm(`Delete webhook endpoint “${endpoint.url}”?`)) return;
    setBusy(endpoint.webhook_endpoint_id);
    setError(null);
    setNotice(null);
    try {
      await orpcCall("/v1/webhooks/delete", {
        id: endpoint.webhook_endpoint_id,
      });
      if (
        editing !== "new" &&
        editing?.webhook_endpoint_id === endpoint.webhook_endpoint_id
      ) {
        setEditing(null);
      }
      setNotice("Webhook endpoint deleted.");
      await refreshAfterMutation();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not delete webhook endpoint.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyGeneratedSecret() {
    if (!generatedSecret) return;
    await navigator.clipboard.writeText(generatedSecret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const inputClass =
    "h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent";

  return (
    <section className="rounded-xl border border-rule bg-panel/65 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] sm:p-6">
      <div>
        <h2 className="text-base font-medium text-ink">Webhook endpoints</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Send completed workflow results to your application. Each request
          includes a signature that your application can verify.
        </p>
        {editing === null && (
          <button
            type="button"
            onClick={startCreating}
            disabled={busy !== null}
            className="mt-3 h-8 rounded-md border border-rule bg-bg/30 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent/35 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add endpoint
          </button>
        )}
      </div>

      {generatedSecret && (
        <div className="mt-5 rounded-lg border border-accent/30 bg-green-3/25 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-accent-bright">
                Signing secret created
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Copy it now. It will not be shown again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGeneratedSecret(null)}
              aria-label="Dismiss signing secret"
              className="text-sm text-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rule bg-bg p-2">
            <code className="min-w-0 flex-1 overflow-x-auto px-2 font-mono text-xs text-ink">
              {generatedSecret}
            </code>
            <button
              type="button"
              onClick={() => void copyGeneratedSecret()}
              className="libretto-button libretto-button--sm h-8"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <form
          onSubmit={save}
          className="mt-4 space-y-4 rounded-lg border border-rule bg-bg/25 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-2 block text-xs uppercase text-muted">
                Endpoint URL
              </span>
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/libretto-webhook"
                required
                autoFocus
                className={inputClass}
              />
            </label>
            <label className={editing === "new" ? "sm:col-span-2" : undefined}>
              <span className="mb-2 block text-xs uppercase text-muted">
                Description
              </span>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Production job results"
                className={inputClass}
              />
            </label>
            {editing !== "new" && (
              <label>
                <span className="mb-2 block text-xs uppercase text-muted">
                  New signing secret
                </span>
                <input
                  type="password"
                  value={signingSecret}
                  onChange={(event) => setSigningSecret(event.target.value)}
                  placeholder="Leave blank to keep the current secret"
                  className={inputClass}
                />
              </label>
            )}
          </div>
          <label className="flex w-fit items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-green-7"
            />
            Deliver workflow results to this endpoint
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy !== null}
              className="h-9 rounded-md border border-accent/35 bg-green-9/25 px-3 text-sm text-ink hover:bg-green-9/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy !== null
                ? "Saving…"
                : editing === "new"
                  ? "Add endpoint"
                  : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              disabled={busy !== null}
              className="h-9 px-3 text-sm text-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-5 rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="mt-5 rounded-md border border-accent/30 bg-green-9/10 px-4 py-3 text-sm text-accent-bright"
        >
          {notice}
        </p>
      )}

      <div className="mt-5 divide-y divide-rule border-y border-rule">
        {endpoints?.map((endpoint) => (
          <div
            key={endpoint.webhook_endpoint_id}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-mono text-xs text-ink">
                  {endpoint.url}
                </p>
                <StatusBadge status={endpoint.active ? "active" : "disabled"} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {endpoint.description || `Updated ${formatDate(endpoint.updated_at)}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => startEditing(endpoint)}
                disabled={busy !== null}
                className="rounded-md border border-rule px-2.5 py-1.5 text-xs text-muted hover:border-accent/35 hover:text-ink disabled:opacity-60"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void remove(endpoint)}
                disabled={busy !== null}
                className={tableDangerActionClass}
              >
                {busy === endpoint.webhook_endpoint_id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
        {endpoints === null && !error && (
          <p className="py-5 text-sm text-muted">Loading webhook endpoints…</p>
        )}
        {endpoints?.length === 0 && (
          <p className="py-5 text-sm text-muted">No webhook endpoints configured.</p>
        )}
      </div>
    </section>
  );
}

function SettingsPanel({ session }: { session: CloudSession }) {
  const [sharing, setSharing] = useState<CodeSharingStatus | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    orpcCall<CodeSharingStatus>("/v1/tenant/codeSharing")
      .then(setSharing)
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "Could not load workflow sharing status.",
        ),
      );
    orpcCall<UsersResponse>("/v1/dashboard/users")
      .then((users) => {
        setCanManage(
          users.users.some(
            (user) => user.id === session.user.id && user.role === "owner",
          ),
        );
      })
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "Could not load workspace permissions.",
        ),
      );
  }, [session.user.id]);

  async function toggleSharing() {
    if (!sharing || !canManage) return;
    const enabled = !sharing.enabled;
    const confirmation = enabled
      ? "Enable public workflow sharing? Workspace members will be able to share workflows with people outside this workspace. Existing workflows remain private until explicitly shared."
      : "Disable public workflow sharing? Every Open and Hosted workflow from this workspace will be removed. Re-enabling sharing will not restore them automatically.";
    if (!window.confirm(confirmation)) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await orpcCall<CodeSharingStatus>(
        "/v1/tenant/updateCodeSharing",
        { enabled },
      );
      setSharing(updated);
      setNotice(
        enabled
          ? "Workflow sharing is enabled. Workflows remain private until someone explicitly shares them."
          : "Workflow sharing is disabled and existing Open and Hosted workflows were removed.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update workflow sharing.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-accent/30 bg-green-9/10 px-4 py-3 text-sm text-accent-bright"
        >
          {notice}
        </p>
      )}
      <WebhookSettingsPanel />
      <details className="group rounded-xl border border-rule bg-panel/65 shadow-[0_12px_40px_rgba(0,0,0,0.16)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 sm:p-6">
          <h2 className="text-base font-medium text-ink">
            Public workflow sharing
          </h2>
          <span
            aria-hidden="true"
            className="text-xs text-muted transition-transform group-open:rotate-180"
          >
            ↓
          </span>
        </summary>
        <div className="border-t border-rule px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <p
            id="workflow-sharing-description"
            className="max-w-2xl text-sm leading-6 text-muted"
          >
            Allow workspace members to share workflows for people outside
            this workspace. They can share source code or provide a Hosted
            workflow with a public run API.
          </p>
          <button
            type="button"
            role="switch"
            aria-label="Public workflow sharing"
            aria-checked={sharing?.enabled ?? false}
            aria-busy={busy}
            aria-describedby="workflow-sharing-description workflow-sharing-state"
            disabled={!sharing || canManage !== true || busy}
            onClick={() => void toggleSharing()}
            className={`mt-4 inline-flex h-8 min-w-24 items-center justify-center rounded-md border px-3 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              sharing?.enabled
                ? "border-accent/45 bg-green-9/35 text-accent-bright hover:bg-green-9/50"
                : "border-rule bg-bg/40 text-muted hover:border-accent/30 hover:text-ink"
            }`}
          >
            {sharing?.enabled ? "Enabled" : "Disabled"}
          </button>
          <div
            id="workflow-sharing-state"
            className="mt-5 border-t border-rule pt-4 text-xs leading-5 text-muted"
          >
            {!sharing
              ? error
                ? "Sharing status is unavailable."
                : "Loading sharing status…"
              : sharing.enabled
                ? "Enabled · Workflows can be shared outside this workspace, but remain private by default."
                : "Disabled · Workflows cannot be shared outside this workspace."}
            {sharing && canManage === null && (
              <span className="mt-1 block">Checking workspace permissions…</span>
            )}
            {sharing && canManage === false && (
              <span className="mt-1 block">
                Only a workspace owner can change this setting.
              </span>
            )}
            {sharing?.enabled && (
              <span className="mt-1 block">
                Disabling this setting removes every current Open and Hosted
                listing. Re-enabling it does not restore previous listings.
              </span>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

export function AuthenticatedDashboardPage({
  section,
}: {
  section: DashboardSection;
}) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateSecret, setShowCreateSecret] = useState(false);
  const [showCreatePhoneNumber, setShowCreatePhoneNumber] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [hasConnectedRepos, setHasConnectedRepos] = useState(false);
  useEffect(() => {
    getCloudSession()
      .then(async (result) => {
        if (!result) {
          window.location.assign("/signin");
          return;
        }
        const status = await getAuthStatus();
        if (!status.hasTenant) {
          window.location.assign(
            `/onboarding?product=${section === "connected_repos" ? "pr-agent" : "chrome-extension"}`,
          );
          return;
        }
        setSession(result);
      })
      .catch(() => window.location.assign("/signin"))
      .finally(() => setChecking(false));
  }, [section]);
  if (checking || !session)
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-sm text-muted">
        Loading account…
      </div>
    );
  const action =
    section === "connected_repos" && hasConnectedRepos ? (
      <a
        href={GITHUB_APP_INSTALL_URL}
        className="libretto-button libretto-button--default inline-flex h-10 items-center no-underline"
      >
        Connect repo
      </a>
    ) : section === "users" ? (
      <button
        type="button"
        onClick={() => setShowInvite(true)}
        className="libretto-button libretto-button--default h-10"
      >
        Add user
      </button>
    ) : section === "secrets" ? (
      <button
        type="button"
        onClick={() => setShowCreateSecret(true)}
        className="libretto-button libretto-button--default h-10"
      >
        Add secret
      </button>
    ) : section === "phone_numbers" ? (
      <button
        type="button"
        onClick={() => setShowCreatePhoneNumber(true)}
        className="libretto-button libretto-button--default h-10"
      >
        Add phone number
      </button>
    ) : section === "api_keys" ? (
      <button
        type="button"
        onClick={() => setShowCreateKey(true)}
        className="libretto-button libretto-button--default h-10"
      >
        Create API key
      </button>
    ) : section === "billing" ? (
      <ManageBillingButton />
    ) : undefined;
  return (
    <DashboardShell section={section} session={session} action={action}>
      {section === "workflows" && <WorkflowsTable />}
      {section === "schedules" && <SchedulesTable />}
      {section === "workflow_runs" && <WorkflowRunsTable />}
      {section === "browser_sessions" && <BrowserSessionsTable />}
      {section === "connected_repos" && (
        <ConnectedReposTable
          onHasRepositoriesChange={setHasConnectedRepos}
        />
      )}
      {section === "users" && (
        <UsersTable
          session={session}
          showInvite={showInvite}
          onCloseInvite={() => setShowInvite(false)}
        />
      )}
      {section === "settings" && <SettingsPanel session={session} />}
      {section === "secrets" && (
        <SecretsTable
          showCreate={showCreateSecret}
          onCloseCreate={() => setShowCreateSecret(false)}
        />
      )}
      {section === "phone_numbers" && (
        <PhoneNumbersTable
          showCreate={showCreatePhoneNumber}
          onCloseCreate={() => setShowCreatePhoneNumber(false)}
        />
      )}
      {section === "api_keys" && (
        <ApiKeysTable
          session={session}
          showCreate={showCreateKey}
          onCloseCreate={() => setShowCreateKey(false)}
        />
      )}
      {section === "billing" && <BillingTable />}
    </DashboardShell>
  );
}
