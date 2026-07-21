import { useEffect, useMemo, useState } from "react";
import { Navbar } from "./components/Navbar";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
  type CloudSession,
} from "./cloudApi";

type DashboardTab = "activity" | "billing";
type ActivityKind = "agent_run" | "workflow_build" | "workflow_run";

interface DashboardJob {
  job_id: string;
  workflow: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DashboardSession {
  session_id: string;
  status: string;
  source: "cli" | "job" | "workflow_build" | null;
  owner_type: "job" | "workflow_build" | "manual" | "debug" | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface WorkflowBuild {
  build_id: string;
  status: string;
  workflow_name: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowsResponse {
  deployed_workflows: Array<{
    name: string;
    deployment_id: string;
    deployment_status: "building" | "ready" | "failed";
    created_at: string;
    updated_at: string;
  }>;
  in_progress_builds: WorkflowBuild[];
}

interface BillingResponse {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  browserHoursUsedThisPeriod: number;
  browserHoursLimit: number | null;
}

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  name: string;
  detail: string;
  status: string;
  createdAt: string;
  durationMs: number | null;
}

const activityLabels: Record<ActivityKind, string> = {
  agent_run: "Local browser task",
  workflow_build: "Workflow created",
  workflow_run: "Workflow run",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return "--";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function statusClass(status: string): string {
  if (["completed", "ready", "closed"].includes(status)) {
    return "border-accent/35 bg-green-9/10 text-accent-bright";
  }
  if (["failed", "cancelled", "unknown"].includes(status)) {
    return "border-red-400/30 bg-red-500/10 text-red-200";
  }
  return "border-amber/30 bg-amber/10 text-amber-bright";
}

function activityDotClass(kind: ActivityKind): string {
  if (kind === "workflow_run")
    return "border-violet-400/35 bg-violet-400/15 text-violet-200";
  if (kind === "workflow_build")
    return "border-blue-400/35 bg-blue-400/15 text-blue-200";
  return "border-accent/35 bg-green-9/10 text-accent-bright";
}

function activityIcon(kind: ActivityKind): string {
  if (kind === "workflow_run") return "↻";
  if (kind === "workflow_build") return "◇";
  return "✦";
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-12 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ChromeExtensionDashboardPage() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("activity");
  const [filter, setFilter] = useState<ActivityKind | "all">("all");
  const [activities, setActivities] = useState<ActivityItem[] | null>(null);
  const [workflowCount, setWorkflowCount] = useState(0);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>("session");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCloudSession()
      .then(async (result) => {
        if (!result) {
          window.location.assign("/signin");
          return;
        }
        const status = await getAuthStatus();
        if (!status.hasTenant) {
          window.location.assign("/onboarding?product=chrome-extension");
          return;
        }
        setSession(result);
      })
      .catch(() => window.location.assign("/signin"))
      .finally(() => setBusy(null));
  }, []);

  useEffect(() => {
    if (!session || activities !== null) return;
    setBusy("activity");
    setError(null);
    Promise.all([
      orpcCall<{ jobs: DashboardJob[] }>("/v1/dashboard/jobs", { limit: 50 }),
      orpcCall<{ sessions: DashboardSession[] }>("/v1/dashboard/sessions", {
        limit: 50,
      }),
      orpcCall<WorkflowsResponse>("/v1/workflows/list"),
    ])
      .then(([jobResult, sessionResult, workflowResult]) => {
        const workflowRuns: ActivityItem[] = jobResult.jobs.map((job) => ({
          id: `run-${job.job_id}`,
          kind: "workflow_run",
          name: job.workflow || "Untitled workflow",
          detail: "Ran in the cloud",
          status: job.status,
          createdAt: job.created_at,
          durationMs:
            job.started_at && job.completed_at
              ? new Date(job.completed_at).getTime() -
                new Date(job.started_at).getTime()
              : null,
        }));
        const builds: ActivityItem[] = [
          ...workflowResult.deployed_workflows.map((workflow) => ({
            id: `workflow-${workflow.deployment_id}-${workflow.name}`,
            kind: "workflow_build" as const,
            name: workflow.name,
            detail: "Saved and ready to run",
            status: workflow.deployment_status,
            createdAt: workflow.created_at,
            durationMs: null,
          })),
          ...workflowResult.in_progress_builds.map((build) => ({
            id: `build-${build.build_id}`,
            kind: "workflow_build" as const,
            name: build.workflow_name || "New workflow",
            detail: build.summary || "Created from a Chrome task",
            status: build.status,
            createdAt: build.created_at,
            durationMs: null,
          })),
        ];
        const agentRuns: ActivityItem[] = sessionResult.sessions
          .filter(
            (browserSession) =>
              browserSession.source === "cli" ||
              browserSession.owner_type === "manual",
          )
          .map((browserSession) => ({
            id: `agent-${browserSession.session_id}`,
            kind: "agent_run",
            name: "One-time browser task",
            detail: "Started locally",
            status: browserSession.status,
            createdAt: browserSession.created_at,
            durationMs: browserSession.duration_ms,
          }));

        setWorkflowCount(workflowResult.deployed_workflows.length);
        setActivities(
          [...workflowRuns, ...builds, ...agentRuns].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        );
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load your activity.",
        ),
      )
      .finally(() => setBusy(null));
  }, [activities, session]);

  useEffect(() => {
    if (!session || activeTab !== "billing" || billing) return;
    setBusy("billing");
    setError(null);
    orpcCall<BillingResponse>("/v1/billing/subscription")
      .then(setBilling)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load billing.",
        ),
      )
      .finally(() => setBusy(null));
  }, [activeTab, billing, session]);

  const filteredActivities = useMemo(
    () =>
      filter === "all"
        ? activities
        : activities?.filter((activity) => activity.kind === filter),
    [activities, filter],
  );

  const completedCount = useMemo(
    () =>
      activities?.filter((activity) =>
        ["completed", "ready", "closed"].includes(activity.status),
      ).length ?? 0,
    [activities],
  );

  async function openBilling() {
    setBusy("billing-portal");
    setError(null);
    try {
      const result = await orpcCall<{ url: string }>(
        "/v1/billing/openPlansPage",
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-8">
        <div className="mb-7 border-b border-rule pb-6">
          <div>
            <p className="mb-2 font-mono text-xs uppercase text-accent">
              Libretto for Chrome
            </p>
            <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
              Your automations
            </h1>
          </div>
        </div>

        <div className="mb-6 flex w-full rounded-lg border border-rule bg-panel p-1 md:w-fit">
          {(["activity", "billing"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setError(null);
              }}
              aria-pressed={activeTab === tab}
              className="h-9 min-w-[120px] rounded-md px-4 text-sm font-medium capitalize text-muted transition-colors hover:text-ink aria-pressed:bg-panel-hi aria-pressed:text-accent-bright"
            >
              {tab}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {busy === "session" && <EmptyState>Loading account...</EmptyState>}

        {activeTab === "activity" && busy !== "session" && (
          <div className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-rule bg-panel/70 p-5">
                <p className="text-xs uppercase text-muted">Saved workflows</p>
                <p className="mt-3 font-serif text-3xl font-[300]">
                  {workflowCount}
                </p>
              </div>
              <div className="rounded-lg border border-rule bg-panel/70 p-5">
                <p className="text-xs uppercase text-muted">Recent activity</p>
                <p className="mt-3 font-serif text-3xl font-[300]">
                  {activities?.length ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-rule bg-panel/70 p-5">
                <p className="text-xs uppercase text-muted">Completed</p>
                <p className="mt-3 font-serif text-3xl font-[300] text-accent-bright">
                  {completedCount}
                </p>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-rule bg-panel/70">
              <div className="flex flex-col gap-4 border-b border-rule px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-medium">Activity</h2>
                  <p className="mt-1 text-xs text-muted">
                    One-time tasks, workflow creation, and scheduled runs
                    together.
                  </p>
                </div>
                <div className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-bg p-1">
                  {(
                    [
                      ["all", "All"],
                      ["agent_run", "Local tasks"],
                      ["workflow_build", "Created"],
                      ["workflow_run", "Runs"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                      className="whitespace-nowrap rounded px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink aria-pressed:bg-panel-hi aria-pressed:text-accent-bright"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {busy === "activity" && (
                <EmptyState>Loading activity...</EmptyState>
              )}
              {filteredActivities?.length === 0 && (
                <EmptyState>No automation activity yet.</EmptyState>
              )}
              {filteredActivities?.map((activity) => (
                <div
                  key={activity.id}
                  className="grid gap-3 border-b border-rule px-4 py-4 last:border-0 md:grid-cols-[44px_minmax(0,1fr)_150px_110px_80px] md:items-center"
                >
                  <span
                    className={`grid size-9 place-items-center rounded-full border text-sm ${activityDotClass(activity.kind)}`}
                  >
                    {activityIcon(activity.kind)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{activity.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {activityLabels[activity.kind]} · {activity.detail}
                    </p>
                  </div>
                  <span className="text-xs text-muted">
                    {formatDate(activity.createdAt)}
                  </span>
                  <span
                    className={`w-fit rounded-full border px-2 py-1 text-xs ${statusClass(activity.status)}`}
                  >
                    {activity.status.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDuration(activity.durationMs)}
                  </span>
                </div>
              ))}
            </section>
          </div>
        )}

        {activeTab === "billing" && busy !== "session" && (
          <section className="rounded-lg border border-rule bg-panel/70 p-5">
            {busy === "billing" && <EmptyState>Loading billing...</EmptyState>}
            {billing && (
              <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="mb-2 text-sm text-muted">Current plan</p>
                  <h2 className="text-3xl font-medium text-ink">
                    {billing.plan}
                  </h2>
                  <p className="mt-3 text-sm text-muted">
                    {billing.browserHoursUsedThisPeriod.toFixed(2)} of{" "}
                    {billing.browserHoursLimit ?? "unlimited"} automation hours
                    used this period.
                  </p>
                  <p className="mt-1 text-xs text-muted/75">
                    Status: {billing.status}
                    {billing.currentPeriodEnd
                      ? ` · Renews ${formatDate(billing.currentPeriodEnd)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openBilling}
                  disabled={busy === "billing-portal"}
                  className="libretto-button libretto-button--default h-10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === "billing-portal" ? "Opening..." : "Manage billing"}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
