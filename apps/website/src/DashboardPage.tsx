import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  getAuthStatus,
  getCloudSession,
  getSetupStatus,
  updateSetupStatus,
  orpcCall,
  type CloudSession,
  type SetupStatus,
} from "./cloudApi";
import { GitHubIcon } from "./icons";

const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";
const HOSTED_BROWSERS_BANNER_DISMISSED_KEY =
  "libretto.dashboard.hostedBrowsersBannerDismissed";

type Tab = "repositories" | "users";

type LinkedRepository = {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
  linked_at: string;
  installation_id: string;
  account_login: string;
};

type LinkedRepositoriesResponse = {
  repositories: LinkedRepository[];
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
  { id: "repositories", label: "Connected repos" },
  { id: "users", label: "Users" },
];

function isDashboardTab(value: string | null): value is Tab {
  return tabs.some((tab) => tab.id === value);
}

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "repositories";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isDashboardTab(tab) ? tab : "repositories";
}

function setDashboardTabUrl(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "repositories") {
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

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function DashboardPage() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [repositories, setRepositories] = useState<LinkedRepository[] | null>(null);
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState<string | null>("session");
  const [savingStep, setSavingStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [showHostedBrowsersBanner, setShowHostedBrowsersBanner] = useState(false);

  useEffect(() => {
    getCloudSession()
      .then(async (result) => {
        if (!result) {
          window.location.assign("/signin");
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
        await Promise.all([
          getSetupStatus()
            .then(setSetupStatus)
            .catch(() => setSetupStatus(null)),
          orpcCall<LinkedRepositoriesResponse>("/v1/github/listLinkedRepositories")
            .then((result) => setRepositories(result.repositories))
            .catch((err) =>
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not load connected repositories.",
              ),
            ),
          orpcCall<UsersResponse>("/v1/dashboard/users")
            .then(setUsers)
            .catch((err) =>
              setError(err instanceof Error ? err.message : "Could not load users."),
            ),
        ]);
      })
      .catch(() => window.location.assign("/signin"))
      .finally(() => setBusy(null));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowHostedBrowsersBanner(
      window.localStorage.getItem(HOSTED_BROWSERS_BANNER_DISMISSED_KEY) !== "1",
    );
  }, []);

  const currentDashboardUser = useMemo(
    () => users?.users.find((user) => user.id === session?.user.id) ?? null,
    [session?.user.id, users],
  );
  const canRemoveUsers = currentDashboardUser?.role === "owner";
  const localAgentReady = setupStatus?.local_agent_setup_complete === true;
  const hasRepos = (repositories?.length ?? 0) > 0;

  async function completeLocalAgentSetup() {
    setSavingStep(true);
    setError(null);
    try {
      const updated = await updateSetupStatus({
        local_agent_setup_complete: true,
      });
      setSetupStatus(updated);
      window.localStorage.setItem("libretto.dashboard.localAgentSetup", "1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update setup.");
    } finally {
      setSavingStep(false);
    }
  }

  async function showLocalAgentSetup() {
    setSavingStep(true);
    setError(null);
    try {
      const updated = await updateSetupStatus({
        local_agent_setup_complete: false,
      });
      setSetupStatus(updated);
      window.localStorage.removeItem("libretto.dashboard.localAgentSetup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update setup.");
    } finally {
      setSavingStep(false);
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

  function dismissHostedBrowsersBanner() {
    window.localStorage.setItem(HOSTED_BROWSERS_BANNER_DISMISSED_KEY, "1");
    setShowHostedBrowsersBanner(false);
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-8">
        {showHostedBrowsersBanner && (
          <section className="mb-6 flex flex-col gap-3 rounded-md border border-rule bg-panel/60 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Need hosted browsers?
              </h2>
            </div>
            <div className="flex items-center gap-4 md:justify-end">
              <a
                href="/dashboard/cloud-browsers"
                className="text-xs text-accent-bright underline decoration-accent/60 underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
              >
                Open cloud browsers
              </a>
              <button
                type="button"
                onClick={dismissHostedBrowsersBanner}
                aria-label="Dismiss hosted browsers banner"
                className="grid size-7 shrink-0 place-items-center rounded-md border border-rule text-muted transition-colors hover:border-accent/45 hover:text-ink"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                >
                  <path d="m4 4 8 8" />
                  <path d="m12 4-8 8" />
                </svg>
              </button>
            </div>
          </section>
        )}

        <div className="mb-7 flex flex-col gap-4 border-b border-rule pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
                Libretto PR Agents
              </h1>
              <span className="rounded-full border border-accent/35 bg-green-9/15 px-2 py-0.5 text-[11px] uppercase text-accent-bright">
                Free
              </span>
            </div>
            <p className="mt-3 max-w-[680px] text-sm leading-6 text-muted">
              Connect your local agent and GitHub repos to automatically open PRs
              when scripts break.
            </p>
          </div>
        </div>

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
              className="h-9 min-w-[132px] rounded-md px-4 text-sm font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-panel-hi aria-pressed:text-accent-bright"
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

        {activeTab === "repositories" && busy !== "session" && (
          <section className="overflow-hidden rounded-lg border border-rule bg-panel/70">
            <div className="flex flex-col gap-3 border-b border-rule px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-medium text-ink">
                  Connected repositories
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Repositories where Libretto can open PRs when scripts break.
                </p>
              </div>
              {hasRepos && (
                <a
                  href={GITHUB_APP_INSTALL_URL}
                  className="libretto-button libretto-button--sm inline-flex h-9 w-fit items-center justify-center whitespace-nowrap px-4"
                >
                  Connect repo
                </a>
              )}
            </div>

            {repositories === null ? (
              <EmptyState>Loading connected repositories...</EmptyState>
            ) : hasRepos ? (
              <div>
                <div className="hidden grid-cols-[minmax(260px,1fr)_110px_170px_90px] border-b border-rule px-4 py-3 text-xs uppercase text-muted md:grid">
                  <span>Repository</span>
                  <span>Access</span>
                  <span>Linked</span>
                  <span>Status</span>
                </div>
                {repositories.map((repository) => (
                  <div
                    key={repository.id}
                    className="grid gap-3 border-b border-rule px-4 py-3 last:border-b-0 md:grid-cols-[minmax(260px,1fr)_110px_170px_90px] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <GitHubIcon className="size-4 shrink-0 text-accent-bright" />
                        <p className="truncate text-sm text-ink">
                          {repository.full_name}
                        </p>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        Installed on {repository.account_login}
                      </p>
                    </div>
                    <span className="text-sm text-muted">
                      {repository.private ? "Private" : "Public"}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDate(repository.linked_at)}
                    </span>
                    <span className="w-fit rounded-full border border-accent/35 bg-green-9/15 px-2 py-1 text-xs text-accent-bright">
                      Linked
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <div className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
                  {!localAgentReady ? (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div>
                        <p className="mb-2 font-mono text-xs uppercase text-accent">
                          Step 1 of 2
                        </p>
                        <h3 className="text-lg font-semibold text-ink">
                          Set up your local agent
                        </h3>
                      </div>
                      <div className="flex min-w-0 flex-col gap-3 md:items-end">
                        <InstallSnippet
                          fathomEvent="Dashboard copy local setup prompt click"
                          onCopy={() => void completeLocalAgentSetup()}
                        />
                        <button
                          type="button"
                          disabled={savingStep}
                          onClick={() => void completeLocalAgentSetup()}
                          className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Already set up? Go to step 2
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="mb-2 font-mono text-xs uppercase text-accent">
                          Step 2 of 2
                        </p>
                        <h3 className="flex items-center gap-3 text-lg font-semibold text-ink">
                          <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                          Connect a GitHub repository
                        </h3>
                        <p className="mt-2 max-w-[620px] text-sm text-muted">
                          Let Libretto open PRs when scripts break.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 md:items-end">
                        <a
                          href={GITHUB_APP_INSTALL_URL}
                          className="libretto-button libretto-button--sm inline-flex h-9 min-w-[148px] items-center justify-center whitespace-nowrap px-4"
                        >
                          Connect GitHub
                        </a>
                        <button
                          type="button"
                          disabled={savingStep}
                          onClick={() => void showLocalAgentSetup()}
                          className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Show step 1
                        </button>
                      </div>
                    </div>
                  )}
                  {error && (
                    <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                      {error}
                    </p>
                  )}
                  </div>
              </div>
            )}
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
