import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
  type CloudSession,
} from "./cloudApi";

type Tab = "jobs" | "sessions" | "users" | "billing";

const CLOUD_SETUP_PROMPT =
  "Fetch and follow https://libretto.sh/cloud.md to set up Libretto Cloud hosted browsers for this project.";
const CLOUD_SETUP_DISMISSED_KEY = "libretto.dashboard.cloudSetupDismissed";

type DashboardJob = {
  job_id: string;
  workflow: string | null;
  status:
    | "queued"
    | "starting_browser"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_class: string | null;
};

type JobsResponse = {
  jobs: DashboardJob[];
  next_cursor?: string;
};

type DashboardSession = {
  session_id: string;
  provider_session_id: string | null;
  browser_provider: string | null;
  status:
    | "queued"
    | "starting"
    | "open"
    | "preserved"
    | "debugging"
    | "closing"
    | "closed"
    | "unknown";
  source: "cli" | "job" | "workflow_build" | null;
  owner_type: "job" | "workflow_build" | "manual" | "debug" | null;
  owner_id: string | null;
  auth_profile_name: string | null;
  live_view_url: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  billed_seconds: number | null;
  created_at: string;
};

type SessionsResponse = {
  sessions: DashboardSession[];
  next_cursor?: string;
};

type UsersResponse = {
  organization: {
    id: string;
    name: string;
    slug: string | null;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    email_verified: boolean;
    image: string | null;
    created_at: string;
  }>;
};

type BillingResponse = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  browserHoursUsedThisPeriod: number;
  browserHoursLimit: number | null;
};

type InviteResponse = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

type RemoveUserResponse = {
  removedUserId: string;
};

type UpdateRoleResponse = {
  userId: string;
  role: "member" | "owner";
};

type DeleteAccountResponse = {
  deletedUserId: string;
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "jobs", label: "Jobs" },
  { id: "sessions", label: "Sessions" },
  { id: "users", label: "Users" },
  { id: "billing", label: "Billing" },
];

function isDashboardTab(value: string | null): value is Tab {
  return tabs.some((tab) => tab.id === value);
}

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "jobs";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isDashboardTab(tab) ? tab : "jobs";
}

function setDashboardTabUrl(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "jobs") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatDate(value: string | null): string {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: DashboardJob["status"]) {
  if (status === "completed") return "border-accent/35 bg-green-9/10 text-accent-bright";
  if (status === "failed" || status === "cancelled") {
    return "border-red-400/30 bg-red-500/10 text-red-200";
  }
  return "border-amber/30 bg-amber/10 text-amber-bright";
}

function sessionStatusClass(status: DashboardSession["status"]) {
  if (status === "open" || status === "preserved") {
    return "border-accent/35 bg-green-9/10 text-accent-bright";
  }
  if (status === "closed") {
    return "border-rule bg-bg/70 text-muted";
  }
  if (status === "unknown") {
    return "border-red-400/30 bg-red-500/10 text-red-200";
  }
  return "border-amber/30 bg-amber/10 text-amber-bright";
}

function formatDuration(value: number | null): string {
  if (value === null) return "--";
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function CloudBrowsersDashboardPage() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);
  const [jobs, setJobs] = useState<DashboardJob[] | null>(null);
  const [jobsCursor, setJobsCursor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DashboardSession[] | null>(null);
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState<string | null>("session");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [showCloudSetupPrompt, setShowCloudSetupPrompt] = useState(false);

  useEffect(() => {
    getCloudSession()
      .then(async (result) => {
        if (!result) {
          window.location.assign(
            `/signin?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`,
          );
          return;
        }
        let status;
        try {
          status = await getAuthStatus();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load account status.",
          );
          return;
        }
        if (!status.hasTenant) {
          window.location.assign("/onboarding");
          return;
        }
        setSession(result);
      })
      .catch(() => window.location.assign("/signin"))
      .finally(() => setBusy(null));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowCloudSetupPrompt(
      window.localStorage.getItem(CLOUD_SETUP_DISMISSED_KEY) !== "1",
    );
  }, []);

  useEffect(() => {
    if (!session) return;
    if (activeTab === "jobs" && jobs === null) {
      setBusy("jobs");
      setError(null);
      orpcCall<JobsResponse>("/v1/dashboard/jobs", { limit: 25 })
        .then((result) => {
          setJobs(result.jobs);
          setJobsCursor(result.next_cursor ?? null);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Could not load jobs."),
        )
        .finally(() => setBusy(null));
    }
    if (activeTab === "users" && users === null) {
      setBusy("users");
      setError(null);
      orpcCall<UsersResponse>("/v1/dashboard/users")
        .then(setUsers)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Could not load users."),
        )
        .finally(() => setBusy(null));
    }
    if (activeTab === "sessions" && sessions === null) {
      setBusy("sessions");
      setError(null);
      orpcCall<SessionsResponse>("/v1/dashboard/sessions", { limit: 25 })
        .then((result) => {
          setSessions(result.sessions);
          setSessionsCursor(result.next_cursor ?? null);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Could not load sessions."),
        )
        .finally(() => setBusy(null));
    }
    if (activeTab === "billing" && billing === null) {
      setBusy("billing");
      setError(null);
      orpcCall<BillingResponse>("/v1/billing/subscription")
        .then(setBilling)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Could not load billing."),
        )
        .finally(() => setBusy(null));
    }
  }, [activeTab, billing, jobs, session, sessions, users]);

  const currentDashboardUser = useMemo(
    () => users?.users.find((user) => user.id === session?.user.id) ?? null,
    [session?.user.id, users],
  );
  const canRemoveUsers = currentDashboardUser?.role === "owner";

  async function loadMoreJobs() {
    if (!jobsCursor) return;
    setBusy("jobs-more");
    setError(null);
    try {
      const result = await orpcCall<JobsResponse>("/v1/dashboard/jobs", {
        limit: 25,
        cursor: jobsCursor,
      });
      setJobs((current) => [...(current ?? []), ...result.jobs]);
      setJobsCursor(result.next_cursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more jobs.");
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreSessions() {
    if (!sessionsCursor) return;
    setBusy("sessions-more");
    setError(null);
    try {
      const result = await orpcCall<SessionsResponse>("/v1/dashboard/sessions", {
        limit: 25,
        cursor: sessionsCursor,
      });
      setSessions((current) => [...(current ?? []), ...result.sessions]);
      setSessionsCursor(result.next_cursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more sessions.");
    } finally {
      setBusy(null);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!users) return;
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const invite = await orpcCall<InviteResponse>("/v1/dashboard/inviteUser", {
        email: inviteEmail,
        role: "member",
      });
      setInviteEmail("");
      setNotice(`Invite sent to ${invite.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setBusy(null);
    }
  }

  async function removeUser(userId: string, email: string) {
    setBusy(`remove-${userId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<RemoveUserResponse>(
        "/v1/dashboard/removeUser",
        { userId },
      );
      setUsers((current) =>
        current
          ? {
              ...current,
              users: current.users.filter((user) => user.id !== result.removedUserId),
            }
          : current,
      );
      setNotice(`Removed ${email} from the organization.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove user.");
    } finally {
      setConfirmRemoveUserId(null);
      setBusy(null);
    }
  }

  async function updateUserRole(userId: string, role: UpdateRoleResponse["role"]) {
    setBusy(`role-${userId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<UpdateRoleResponse>(
        "/v1/dashboard/updateUserRole",
        { userId, role },
      );
      setUsers((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === result.userId ? { ...user, role: result.role } : user,
              ),
            }
          : current,
      );
      setNotice("User role updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user role.");
    } finally {
      setBusy(null);
    }
  }

  async function openBilling() {
    setBusy("billing-portal");
    setError(null);
    try {
      const result = await orpcCall<{ url: string }>("/v1/billing/openPlansPage");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete-account");
    setError(null);
    try {
      await orpcCall<DeleteAccountResponse>("/v1/dashboard/deleteAccount");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account.");
      setShowDeleteAccountDialog(false);
      setBusy(null);
    }
  }

  function dismissCloudSetupPrompt() {
    window.localStorage.setItem(CLOUD_SETUP_DISMISSED_KEY, "1");
    setShowCloudSetupPrompt(false);
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-8">
        <div className="mb-7 flex flex-col gap-4 border-b border-rule pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
              Cloud Browsers
            </h1>
          </div>
        </div>

        {showCloudSetupPrompt && (
          <section className="mb-6 rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="mb-2 font-mono text-xs uppercase text-accent">
                  Cloud setup
                </p>
                <h2 className="text-lg font-semibold text-ink">
                  Set up hosted browser runs
                </h2>
                <p className="mt-2 max-w-[620px] text-sm text-muted">
                  Copy this into your local coding agent to sign in, store an API
                  key, switch the provider to Libretto Cloud, and deploy.
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-3 md:items-end">
                <InstallSnippet
                  prompt={CLOUD_SETUP_PROMPT}
                  fathomEvent="Cloud dashboard copy setup prompt click"
                />
                <button
                  type="button"
                  onClick={dismissCloudSetupPrompt}
                  className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
                >
                  Already set up
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="mb-6 flex w-full overflow-x-auto rounded-lg border border-rule bg-panel p-1 md:w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setDashboardTabUrl(tab.id);
                setActiveTab(tab.id);
                setError(null);
                setNotice(null);
                setConfirmRemoveUserId(null);
                setShowDeleteAccountDialog(false);
              }}
              aria-pressed={activeTab === tab.id}
              className="h-9 min-w-[104px] rounded-md px-4 text-sm font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-panel-hi aria-pressed:text-accent-bright"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 rounded-md border border-accent/30 bg-green-9/10 px-3 py-2 text-sm text-accent-bright">
            {notice}
          </p>
        )}

        {busy === "session" && <EmptyState>Loading account...</EmptyState>}

        {activeTab === "jobs" && busy !== "session" && (
          <section className="overflow-hidden rounded-lg border border-rule bg-panel/70">
            <div>
              <div className="hidden grid-cols-[1fr_132px_150px_92px] border-b border-rule px-4 py-3 text-xs uppercase text-muted lg:grid">
                <span>Workflow</span>
                <span>Status</span>
                <span>Created</span>
                <span>Runtime</span>
              </div>
              {busy === "jobs" && <EmptyState>Loading jobs...</EmptyState>}
              {jobs?.length === 0 && <EmptyState>No hosted jobs yet.</EmptyState>}
              {jobs?.map((job) => (
                <div
                  key={job.job_id}
                  className="grid gap-3 border-b border-rule px-4 py-3 last:border-b-0 lg:grid-cols-[1fr_132px_150px_92px] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {job.workflow || "Untitled workflow"}
                    </p>
                    <p className="truncate text-xs text-muted">{job.job_id}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 md:block">
                    <span
                      className={`w-fit rounded-full border px-2 py-1 text-xs ${statusClass(job.status)}`}
                    >
                      {job.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted lg:hidden">
                      Created {formatDate(job.created_at)}
                    </span>
                    <span className="text-xs text-muted lg:hidden">
                      Runtime {formatDuration(
                        job.started_at && job.completed_at
                          ? new Date(job.completed_at).getTime() -
                              new Date(job.started_at).getTime()
                          : null,
                      )}
                    </span>
                  </div>
                  <span className="hidden text-xs text-muted lg:block">
                    {formatDate(job.created_at)}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDuration(
                      job.started_at && job.completed_at
                        ? new Date(job.completed_at).getTime() -
                            new Date(job.started_at).getTime()
                        : null,
                    )}
                  </span>
                </div>
              ))}
              {jobsCursor && (
                <div className="border-t border-rule p-3">
                  <button
                    type="button"
                    onClick={loadMoreJobs}
                    disabled={busy === "jobs-more"}
                    className="h-9 rounded-md border border-rule bg-bg px-3 text-sm text-muted transition-colors hover:border-accent/45 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === "jobs-more" ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "sessions" && busy !== "session" && (
          <section className="overflow-hidden rounded-lg border border-rule bg-panel/70">
            <div>
              <div className="hidden grid-cols-[minmax(260px,1fr)_120px_126px_150px_92px] border-b border-rule px-4 py-3 text-left text-xs uppercase text-muted lg:grid">
                <span>Session</span>
                <span>Status</span>
                <span>Source</span>
                <span>Created</span>
                <span>Runtime</span>
              </div>
              {busy === "sessions" && <EmptyState>Loading sessions...</EmptyState>}
              {sessions?.length === 0 && (
                <EmptyState>No browser sessions yet.</EmptyState>
              )}
              {sessions?.map((browserSession) => (
                <div
                  key={browserSession.session_id}
                  className="grid gap-3 border-b border-rule px-4 py-3 text-left last:border-b-0 lg:grid-cols-[minmax(260px,1fr)_120px_126px_150px_92px] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {browserSession.source === "job"
                        ? "Job browser session"
                        : browserSession.source === "workflow_build"
                          ? "Workflow build session"
                          : "Browser session"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {browserSession.session_id}
                    </p>
                    {browserSession.auth_profile_name && (
                      <p className="truncate text-xs text-muted/75">
                        Profile: {browserSession.auth_profile_name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 lg:block">
                    <span
                      className={`inline-flex w-fit min-w-[64px] justify-center rounded-full border px-2 py-1 text-xs ${sessionStatusClass(browserSession.status)}`}
                    >
                      {browserSession.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted lg:hidden">
                      Created {formatDate(browserSession.created_at)}
                    </span>
                    <span className="text-xs text-muted lg:hidden">
                      Runtime {formatDuration(browserSession.duration_ms)}
                    </span>
                  </div>
                  <span className="text-xs text-muted">
                    {browserSession.source ?? browserSession.owner_type ?? "--"}
                  </span>
                  <span className="hidden text-xs text-muted lg:block">
                    {formatDate(browserSession.created_at)}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDuration(browserSession.duration_ms)}
                  </span>
                </div>
              ))}
              {sessionsCursor && (
                <div className="border-t border-rule p-3">
                  <button
                    type="button"
                    onClick={loadMoreSessions}
                    disabled={busy === "sessions-more"}
                    className="h-9 rounded-md border border-rule bg-bg px-3 text-sm text-muted transition-colors hover:border-accent/45 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === "sessions-more" ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "users" && busy !== "session" && (
          <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="overflow-hidden rounded-lg border border-rule bg-panel/70">
              <div>
                <div className="hidden grid-cols-[1fr_110px_120px_128px] border-b border-rule px-4 py-3 text-xs uppercase text-muted md:grid">
                  <span>User</span>
                  <span>Role</span>
                  <span>Joined</span>
                  <span />
                </div>
                {busy === "users" && <EmptyState>Loading users...</EmptyState>}
                {users?.users.map((user) => (
                  <div
                    key={user.id}
                    className="grid gap-3 border-b border-rule px-4 py-3 last:border-b-0 md:grid-cols-[1fr_110px_120px_128px] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm text-ink">{user.name}</p>
                        {user.id === session?.user.id && (
                          <span className="shrink-0 rounded-full border border-accent/35 bg-green-9/15 px-2 py-0.5 text-[11px] text-accent-bright">
                            me
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted">{user.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {canRemoveUsers && user.id !== session?.user.id ? (
                        <select
                          value={user.role}
                          onChange={(event) =>
                            void updateUserRole(
                              user.id,
                              event.target.value as UpdateRoleResponse["role"],
                            )
                          }
                          disabled={busy === `role-${user.id}`}
                          className="h-8 rounded-md border border-rule bg-bg px-2 text-sm text-muted outline-none transition-colors hover:border-accent/45 hover:text-ink focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="member">member</option>
                          <option value="owner">owner</option>
                        </select>
                      ) : (
                        <span className="text-sm text-muted">{user.role}</span>
                      )}
                      <span className="text-xs text-muted md:hidden">
                        {formatDate(user.created_at)}
                      </span>
                    </div>
                    <span className="hidden text-xs text-muted md:block">
                      {formatDate(user.created_at)}
                    </span>
                    <div className="flex md:justify-end">
                      {user.id === session?.user.id ? (
                        <button
                          type="button"
                          onClick={() => setShowDeleteAccountDialog(true)}
                          aria-label="Delete account"
                          className="h-6 rounded border border-red-400/20 px-1.5 text-[10px] uppercase text-red-200/80 transition-colors hover:border-red-300/40 hover:bg-red-500/10 hover:text-red-100"
                        >
                          Delete account
                        </button>
                      ) : canRemoveUsers && (
                        confirmRemoveUserId === user.id ? (
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <button
                              type="button"
                              onClick={() => void removeUser(user.id, user.email)}
                              disabled={busy === `remove-${user.id}`}
                              className="h-8 rounded-md border border-red-400/35 bg-red-500/10 px-2.5 text-xs text-red-100 transition-colors hover:border-red-300/55 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busy === `remove-${user.id}` ? "Removing..." : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveUserId(null)}
                              disabled={busy === `remove-${user.id}`}
                              className="h-8 rounded-md border border-rule px-2.5 text-xs text-muted transition-colors hover:border-accent/45 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveUserId(user.id)}
                            className="h-8 rounded-md border border-red-400/25 px-2.5 text-xs text-red-200 transition-colors hover:border-red-300/45 hover:bg-red-500/10"
                          >
                            Remove
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={inviteUser}
              className="h-fit rounded-lg border border-rule bg-panel/70 p-4"
            >
              <h2 className="mb-4 text-base font-medium text-ink">Invite user</h2>
              <label className="block">
                <span className="mb-2 block text-xs uppercase text-muted">
                  Email
                </span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={busy === "invite"}
                className="libretto-button libretto-button--default mt-4 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "invite" ? "Sending..." : "Send invite"}
              </button>
            </form>
          </section>
        )}

        {activeTab === "billing" && busy !== "session" && (
          <section className="rounded-lg border border-rule bg-panel/70 p-5">
            {busy === "billing" && <EmptyState>Loading billing...</EmptyState>}
            {billing && (
              <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="mb-2 text-sm text-muted">Current plan</p>
                  <h2 className="text-3xl font-medium text-ink">{billing.plan}</h2>
                  <p className="mt-3 text-sm text-muted">
                    {billing.browserHoursUsedThisPeriod.toFixed(2)} of{" "}
                    {billing.browserHoursLimit ?? "unlimited"} browser hours used
                    this period.
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
                  {busy === "billing-portal" ? "Opening..." : "Open billing"}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
      {showDeleteAccountDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div className="w-full max-w-[520px] rounded-lg border border-red-400/35 bg-panel p-6 shadow-2xl shadow-black/50">
            <p className="mb-3 font-mono text-xs uppercase text-red-200">
              Delete account
            </p>
            <h2
              id="delete-account-title"
              className="font-serif text-[34px] font-[300] leading-tight text-ink"
            >
              Are you sure you want to delete your account?
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              This deletes your Libretto Cloud user, sign-in methods, sessions,
              API keys, and organization membership. Tenant data is preserved.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteAccountDialog(false)}
                disabled={busy === "delete-account"}
                className="h-10 rounded-md border border-rule px-4 text-sm text-muted transition-colors hover:border-accent/45 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={busy === "delete-account"}
                className="h-10 rounded-md border border-red-400/35 bg-red-500/10 px-4 text-sm text-red-100 transition-colors hover:border-red-300/55 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "delete-account" ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
