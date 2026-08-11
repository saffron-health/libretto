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
  open_workflow: (Publication & {
    open_workflow_url: string;
  }) | null;
  hosted_workflow: (Publication & {
    page_url: string;
  }) | null;
};

type RunSummary = {
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

const cardClass =
  "rounded-xl border border-rule bg-panel/65 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] sm:p-6";
const buttonClass =
  "libretto-button libretto-button--default inline-flex h-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function WorkflowDetailPage({ workflow }: { workflow: string }) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [runs, setRuns] = useState<RunSummary | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [nextDetail, nextRuns] = await Promise.all([
      orpcCall<WorkflowDetail>("/v1/workflows/get", { workflow }),
      orpcCall<RunSummary>("/v1/workflows/hostedRuns", {
        workflow,
        limit: 100,
      }),
    ]);
    setDetail(nextDetail);
    setRuns(nextRuns);
    setDescription(nextDetail.hosted_workflow?.description ?? "");
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

  async function shareOpen(acknowledgement?: {
    reviewId: string;
    acknowledgeWarnings: boolean;
  }): Promise<void> {
    const response = await orpcCall<ShareResponse>("/v1/workflows/share", {
      workflow,
      refresh: Boolean(detail?.open_workflow),
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
      setNotice("Open workflow published.");
      return;
    }
    if (response.status === "review_expired") {
      throw new Error("The privacy review expired. Publish again to rerun it.");
    }
    if (!("findings" in response)) return;
    const findings = response.findings
      .map(
        (finding) =>
          `${finding.file}${finding.line ? `:${finding.line}` : ""}: ${finding.explanation}`,
      )
      .join("\n");
    if (response.status === "blocked") {
      throw new Error(`Publishing is blocked by the privacy review:\n${findings}`);
    }
    if (
      window.confirm(
        `The privacy review found warnings:\n\n${findings}\n\nPublish anyway?`,
      )
    ) {
      await shareOpen({
        reviewId: response.review_id,
        acknowledgeWarnings: true,
      });
    }
  }

  if (!session || !detail) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-sm text-muted">
        {error ?? "Loading workflow…"}
      </div>
    );
  }

  const canPublish =
    detail.sharing_enabled && detail.deployment_status === "ready";
  return (
    <DashboardShell
      section="workflows"
      session={session}
      title={detail.workflow}
      description={`Updated ${formatDate(detail.updated_at)}`}
      action={
        <a
          href="/dashboard/workflows"
          className="libretto-button inline-flex h-10 items-center no-underline"
        >
          Back to workflows
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
        {!detail.sharing_enabled && (
          <p className="rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Workflow sharing is disabled. A workspace owner can enable it in{" "}
            <a href="/dashboard/settings" className="underline">
              Settings
            </a>
            .
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className={cardClass}>
            <h2 className="text-lg font-medium text-ink">Open workflow</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Publish source that other users can inspect and import.
            </p>
            {detail.open_workflow && (
              <p className="mt-3 text-xs text-muted">
                {detail.open_workflow.stale
                  ? "A newer deployment is available."
                  : "Published from the current workflow."}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canPublish || busy !== null}
                onClick={() =>
                  void runAction("open", async () => shareOpen())
                }
                className={buttonClass}
              >
                {busy === "open"
                  ? "Publishing…"
                  : detail.open_workflow
                    ? "Refresh"
                    : "Publish"}
              </button>
              {detail.open_workflow && (
                <>
                  <a
                    href={detail.open_workflow.open_workflow_url}
                    target="_blank"
                    rel="noreferrer"
                    className="libretto-button inline-flex h-10 items-center no-underline"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm("Remove this Open workflow?")) return;
                      void runAction("unshare", async () => {
                        await orpcCall("/v1/workflows/unshare", { workflow });
                        setNotice("Open workflow removed.");
                      });
                    }}
                    className="libretto-button h-10"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </section>

          <section className={cardClass}>
            <h2 className="text-lg font-medium text-ink">Hosted workflow</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Publish an opaque API that external users run with their own
              credentials.
            </p>
            <label className="mt-4 block text-xs text-muted">
              Public description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                className="mt-2 w-full rounded-md border border-rule bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canPublish || busy !== null}
                onClick={() =>
                  void runAction("host", async () => {
                    await orpcCall("/v1/workflows/host", {
                      workflow,
                      description: description.trim() || undefined,
                    });
                    setNotice("Hosted workflow published.");
                  })
                }
                className={buttonClass}
              >
                {busy === "host"
                  ? "Publishing…"
                  : detail.hosted_workflow
                    ? "Update"
                    : "Publish"}
              </button>
              {detail.hosted_workflow && (
                <>
                  <a
                    href={detail.hosted_workflow.page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="libretto-button inline-flex h-10 items-center no-underline"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm("Unhost this workflow?")) return;
                      void runAction("unhost", async () => {
                        await orpcCall("/v1/workflows/unhost", { workflow });
                        setNotice("Hosted workflow removed.");
                      });
                    }}
                    className="libretto-button h-10"
                  >
                    Unhost
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

        {runs?.has_publication_history && (
          <section className={cardClass}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-medium text-ink">
                  External Hosted runs
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Times and outcomes only. Consumer identity and run data stay
                  private.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ["30-day runs", runs.metrics.runs_last_30_days],
                  ["Succeeded", runs.metrics.succeeded_last_30_days],
                  ["Failed", runs.metrics.failed_last_30_days],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-rule px-3 py-2">
                    <p className="text-lg text-ink">{value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr>
                    <th className="border-b border-rule px-3 py-2 text-left text-xs text-muted">
                      Ran at
                    </th>
                    <th className="border-b border-rule px-3 py-2 text-left text-xs text-muted">
                      Outcome
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.runs.map((run, index) => (
                    <tr key={`${run.ran_at}-${index}`}>
                      <td className="border-b border-rule px-3 py-3 text-sm text-muted">
                        {formatDate(run.ran_at)}
                      </td>
                      <td className="border-b border-rule px-3 py-3 text-sm text-ink">
                        {run.outcome.replace("_", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {runs.runs.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  No external runs yet.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
