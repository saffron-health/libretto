import { useEffect, useState } from "react";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
  type CloudSession,
} from "./cloudApi";
import { DashboardShell } from "./AuthenticatedDashboardPage";

type Publication = {
  description: string | null;
  stale: boolean;
};

type WorkflowDetail = {
  workflow: string;
  deployment_status: "building" | "ready" | "failed";
  updated_at: string;
  sharing_enabled: boolean;
  publication:
    | (Publication & {
        page_url: string;
        hosted_workflow: string;
        deployment_version: number;
      })
    | null;
};

type HostedRunSummary = {
  has_publication_history: boolean;
  metrics: {
    runs_last_30_days: number;
    succeeded_last_30_days: number;
    failed_last_30_days: number;
  };
  runs: Array<{
    ran_at: string;
    outcome: "succeeded" | "failed" | "in_progress" | "cancelled";
  }>;
};

type WorkflowRun = {
  job_id: string;
  status: "queued" | "starting_browser" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_class: string | null;
};

type PrivacyFinding = {
  file: string;
  line: number | null;
  explanation: string;
};

type ShareResponse =
  | { status: "created" | "existing" | "refreshed" }
  | {
      status: "needs_review" | "blocked";
      review_id: string;
      findings: PrivacyFinding[];
    }
  | { status: "review_expired" };

const panelClass =
  "overflow-hidden rounded-xl border border-rule bg-panel/55 shadow-[0_12px_40px_rgba(0,0,0,0.14)]";
const primaryButtonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-accent/45 bg-green-9/55 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink transition-colors hover:bg-green-9/80 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButtonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-rule bg-bg/35 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted no-underline transition-colors hover:border-accent/35 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return "—";
  const seconds = Math.max(
    0,
    Math.round(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    ),
  );
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusPill({ value }: { value: string }) {
  const success = value === "completed" || value === "succeeded";
  const failed = value === "failed";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] ${
        success
          ? "border-accent/25 bg-green-9/10 text-accent-bright"
          : failed
            ? "border-red-400/25 bg-red-500/10 text-red-200"
            : "border-rule bg-bg/40 text-muted"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function EmptyRuns({ hosted }: { hosted?: boolean }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm text-ink">
        {hosted ? "No external Hosted runs yet." : "No workflow runs yet."}
      </p>
      <p className="mt-1 text-xs text-muted">
        Runs will appear here after this workflow is invoked.
      </p>
    </div>
  );
}

function WorkflowRunsTable({ runs }: { runs: WorkflowRun[] }) {
  if (runs.length === 0) return <EmptyRuns />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] border-collapse">
        <thead>
          <tr className="border-b border-rule bg-panel-hi/30">
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Started
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Status
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Runtime
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.job_id} className="border-b border-rule last:border-0">
              <td className="px-5 py-4 text-sm text-muted">
                {formatDate(run.started_at ?? run.created_at)}
              </td>
              <td className="px-5 py-4">
                <StatusPill value={run.status} />
              </td>
              <td className="px-5 py-4 font-mono text-xs text-muted">
                {formatDuration(run.started_at, run.completed_at)}
              </td>
              <td className="px-5 py-4 text-sm text-muted">
                {run.failure_class ?? (run.status === "completed" ? "Completed" : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HostedRunsTable({ summary }: { summary: HostedRunSummary }) {
  return (
    <>
      <div className="grid gap-px border-b border-rule bg-rule sm:grid-cols-3">
        {[
          ["Runs in 30 days", summary.metrics.runs_last_30_days],
          ["Succeeded", summary.metrics.succeeded_last_30_days],
          ["Failed", summary.metrics.failed_last_30_days],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel px-5 py-4">
            <p className="font-mono text-2xl text-ink">{value}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">
              {label}
            </p>
          </div>
        ))}
      </div>
      {summary.runs.length === 0 ? (
        <EmptyRuns hosted />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-rule bg-panel-hi/30">
                <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  Ran at
                </th>
                <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.runs.map((run, index) => (
                <tr
                  key={`${run.ran_at}-${index}`}
                  className="border-b border-rule last:border-0"
                >
                  <td className="px-5 py-4 text-sm text-muted">
                    {formatDate(run.ran_at)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill value={run.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function WorkflowDetailPage({ workflow }: { workflow: string }) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [hostedRuns, setHostedRuns] = useState<HostedRunSummary | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [nextDetail, nextHostedRuns, nextWorkflowRuns] = await Promise.all([
      orpcCall<WorkflowDetail>("/v1/workflows/get", { workflow }),
      orpcCall<HostedRunSummary>("/v1/workflows/hostedRuns", {
        workflow,
        limit: 100,
      }),
      orpcCall<{ jobs: WorkflowRun[] }>("/v1/dashboard/jobs", {
        workflow,
        limit: 100,
      }),
    ]);
    setDetail(nextDetail);
    setHostedRuns(nextHostedRuns);
    setWorkflowRuns(nextWorkflowRuns.jobs);
    setDescription(nextDetail.publication?.description ?? "");
  }

  useEffect(() => {
    getCloudSession()
      .then(async (nextSession) => {
        if (!nextSession) {
          window.location.assign("/signin");
          return;
        }
        const status = await getAuthStatus();
        if (!status.hasTenant) {
          window.location.assign("/onboarding?product=chrome-extension");
          return;
        }
        setSession(nextSession);
        await refresh();
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load workflow.",
        ),
      );
  }, [workflow]);

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function sharePublicly(acknowledgement?: {
    reviewId: string;
    acknowledgeWarnings: boolean;
  }): Promise<void> {
    const response = await orpcCall<ShareResponse>("/v1/workflows/share", {
      workflow,
      refresh: Boolean(detail?.publication),
      description: description.trim() || undefined,
      privacyReview: {
        capability: "workflow_privacy_review_v1",
        ...(acknowledgement
          ? {
              reviewId: acknowledgement.reviewId,
              acknowledgeWarnings: acknowledgement.acknowledgeWarnings,
            }
          : {}),
      },
    });
    if (!("findings" in response) && response.status !== "review_expired") {
      setNotice("Workflow shared publicly.");
      return;
    }
    if (response.status === "review_expired") {
      throw new Error("The privacy review expired. Share again to rerun it.");
    }
    if (!("findings" in response)) return;
    const findings = response.findings
      .map(
        (finding) =>
          `${finding.file}${finding.line ? `:${finding.line}` : ""}: ${finding.explanation}`,
      )
      .join("\n");
    if (response.status === "blocked") {
      throw new Error(`Sharing is blocked by the privacy review:\n${findings}`);
    }
    if (
      window.confirm(
        `The privacy review found warnings:\n\n${findings}\n\nShare publicly anyway?`,
      )
    ) {
      await sharePublicly({
        reviewId: response.review_id,
        acknowledgeWarnings: true,
      });
    }
  }

  if (!session || !detail || !hostedRuns) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-sm text-muted">
        {error ?? "Loading workflow…"}
      </div>
    );
  }

  const canShare =
    detail.sharing_enabled && detail.deployment_status === "ready";
  const hasPublicWorkflow = Boolean(detail.publication);

  return (
    <DashboardShell
      section="workflows"
      session={session}
      title={detail.workflow}
      description={`Updated ${formatDate(detail.updated_at)}`}
      action={
        <a href="/dashboard/workflows" className={secondaryButtonClass}>
          ← Workflows
        </a>
      }
    >
      <div className="space-y-6">
        {error && (
          <p className="whitespace-pre-wrap rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-accent/30 bg-green-9/10 px-4 py-3 text-sm text-accent-bright">
            {notice}
          </p>
        )}

        <section className={panelClass}>
          <div className="border-b border-rule px-5 py-4">
            <h2 className="text-base font-medium text-ink">Runs</h2>
          </div>
          <WorkflowRunsTable runs={workflowRuns} />
        </section>

        {detail.publication && (
          <section className={panelClass}>
            <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-medium text-ink">
                  Shared publicly
                </h2>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide ${
                    detail.publication.stale
                      ? "border-rule text-muted"
                      : "border-accent/30 bg-green-9/10 text-accent-bright"
                  }`}
                >
                  {detail.publication.stale ? "Older version" : "Live"}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href={detail.publication.page_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted no-underline hover:text-ink"
                >
                  Public page ↗
                </a>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-b border-rule px-5 py-3 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-[10px] uppercase tracking-[0.08em] text-muted sm:max-w-xl">
                Description
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  className="mt-1 h-8 w-full rounded-md border border-rule bg-bg/55 px-3 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent/50"
                />
              </label>
              <button
                type="button"
                disabled={!canShare || busy !== null}
                onClick={() =>
                  void runAction("share", async () => sharePublicly())
                }
                className={
                  detail.publication.stale
                    ? primaryButtonClass
                    : "inline-flex h-8 items-center justify-center rounded-md border border-accent/35 bg-green-9/10 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-accent-bright transition-colors hover:bg-green-9/25 disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                {busy === "share"
                  ? "Sharing…"
                  : detail.publication.stale
                    ? "Share latest"
                    : "Update shared version"}
              </button>
            </div>
            <HostedRunsTable summary={hostedRuns} />
            <div className="flex justify-end border-t border-rule px-5 py-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm("Remove the public API and source code?"))
                    return;
                  void runAction("unshare", async () => {
                    await orpcCall("/v1/workflows/unshare", { workflow });
                    setNotice("Workflow is no longer shared publicly.");
                  });
                }}
                className="text-xs text-red-200/75 hover:text-red-200 disabled:opacity-40"
              >
                Stop sharing
              </button>
            </div>
          </section>
        )}

        {!hasPublicWorkflow && (
          <section className={panelClass}>
            <button
              type="button"
              aria-expanded={sharingOpen}
              onClick={() => setSharingOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-panel-hi/25"
            >
              <span>
                <span className="block text-sm font-medium text-ink">
                  Share workflow outside this workspace
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Share a public run API with visible, reusable source code.
                </span>
              </span>
              <span className="text-xs text-muted" aria-hidden>
                {sharingOpen ? "↑" : "↓"}
              </span>
            </button>
            {sharingOpen && (
              <div className="border-t border-rule">
                {!detail.sharing_enabled && (
                  <div className="border-b border-amber-300/20 bg-amber-300/5 px-5 py-3 text-xs text-amber-100">
                    Sharing is disabled. Enable it in{" "}
                    <a href="/dashboard/settings" className="underline">
                      Settings
                    </a>
                    .
                  </div>
                )}
                <div className="p-4">
                  <label className="block text-[10px] uppercase tracking-[0.08em] text-muted">
                    Description
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={2000}
                      className="mt-1 h-8 w-full rounded-md border border-rule bg-bg/55 px-3 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent/50"
                    />
                  </label>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    Libretto reviews the source for sensitive information
                    before sharing.
                  </p>
                  <button
                    type="button"
                    disabled={!canShare || busy !== null}
                    onClick={() =>
                      void runAction("share", async () => sharePublicly())
                    }
                    className={`${primaryButtonClass} mt-4 w-full`}
                  >
                    {busy === "share" ? "Sharing…" : "Share publicly"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
