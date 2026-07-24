import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { InstallSnippet } from "./components/InstallSnippet";
import { getAuthStatus, getCloudSession, orpcCall } from "./cloudApi";
import type { CloudSession } from "./cloudApi";
import { GitHubIcon } from "./icons";

const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";
const DEBUGGER_DOCS_URL = "/docs/reference/runtime/playwright-debugger";
const DEBUGGER_PROMPT =
  "Add the Libretto Playwright debugging agent to my existing automation. " +
  "Install libretto-playwright-debugger, then follow " +
  "https://libretto.sh/docs/reference/runtime/playwright-debugger. Create a " +
  "module-scope playwrightDebugger with createPlaywrightDebugger, my repo " +
  "(owner, repo, baseBranch), and model configuration, using LIBRETTO_API_KEY " +
  "for GitHub authentication. At the existing failure point, before " +
  "Playwright teardown, call await playwrightDebugger.debugFailure(error, page) " +
  "with the live page that observed the failure.";

type Tab = "repositories" | "users";

interface SetupStatus {
  debugger_added: boolean;
}

interface LinkedRepository {
  id: string;
  full_name: string;
  private: boolean;
  linked_at: string;
  account_login: string;
}

interface UsersResponse {
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
  }>;
}

interface InviteResponse {
  email: string;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "repositories", label: "Connected repos" },
  { id: "users", label: "Users" },
];

function formatDate(value: string): string {
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

export function PrAgentDashboardPage() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("repositories");
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [repositories, setRepositories] = useState<LinkedRepository[] | null>(
    null,
  );
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState<string | null>("session");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getCloudSession()
      .then(async (result) => {
        if (!result) {
          window.location.assign("/signin");
          return;
        }
        const status = await getAuthStatus();
        if (!status.hasTenant) {
          window.location.assign("/onboarding?product=pr-agent");
          return;
        }
        setSession(result);
        const [repoResult, userResult, setupResult] = await Promise.all([
          orpcCall<{ repositories: LinkedRepository[] }>(
            "/v1/github/listLinkedRepositories",
          ),
          orpcCall<UsersResponse>("/v1/dashboard/users"),
          orpcCall<SetupStatus>("/v1/tenant/setupStatus").catch(() => ({
            debugger_added: false,
          })),
        ]);
        setRepositories(repoResult.repositories);
        setUsers(userResult);
        setSetupStatus(setupResult);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load dashboard.",
        ),
      )
      .finally(() => setBusy(null));
  }, []);

  const hasRepos = (repositories?.length ?? 0) > 0;
  const debuggerReady = setupStatus?.debugger_added === true;
  const currentUser = useMemo(
    () => users?.users.find((user) => user.id === session?.user.id) ?? null,
    [session?.user.id, users],
  );

  async function completeDebuggerSetup() {
    setBusy("debugger");
    setError(null);
    try {
      const updated = await orpcCall<SetupStatus>("/v1/tenant/setupStatus", {
        debugger_added: true,
      });
      setSetupStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update setup.");
    } finally {
      setBusy(null);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const invite = await orpcCall<InviteResponse>(
        "/v1/dashboard/inviteUser",
        { email: inviteEmail, role: "member" },
      );
      setInviteEmail("");
      setNotice(`Invite sent to ${invite.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-8">
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
              Connect your local agent and GitHub repos to automatically open
              PRs when scripts break.
            </p>
          </div>
        </div>

        <div className="mb-6 flex w-full overflow-x-auto rounded-lg border border-rule bg-panel p-1 md:w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setError(null);
                setNotice(null);
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
            ) : !hasRepos ? (
              <div className="p-4">
                <div className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="mb-2 font-mono text-xs uppercase text-accent">
                        Step 1 of 2
                      </p>
                      <h3 className="flex items-center gap-3 text-lg font-semibold text-ink">
                        <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                        Connect a GitHub repository
                      </h3>
                      <p className="mt-2 max-w-[620px] text-sm text-muted">
                        Connect the repository where your automations live so
                        Libretto can open scoped fix pull requests.
                      </p>
                    </div>
                    <a
                      href={GITHUB_APP_INSTALL_URL}
                      className="libretto-button libretto-button--sm inline-flex h-9 min-w-[148px] items-center justify-center whitespace-nowrap px-4"
                    >
                      Connect GitHub
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <>
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

                {!debuggerReady && setupStatus !== null && (
                  <div className="border-t border-rule p-4">
                    <div className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="min-w-0">
                          <p className="mb-2 font-mono text-xs uppercase text-accent">
                            Step 2 of 2
                          </p>
                          <h3 className="text-lg font-semibold text-ink">
                            Add the debugger to your Playwright script
                          </h3>
                          <p className="mt-2 max-w-[620px] text-sm leading-6 text-muted">
                            Paste this prompt into your coding agent to install
                            the debugger and wire failure reporting into your
                            existing automation.
                          </p>
                          <a
                            href={DEBUGGER_DOCS_URL}
                            className="mt-2 inline-block text-xs text-accent-bright underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                          >
                            View runtime reference
                          </a>
                        </div>
                        <div className="flex min-w-0 flex-col gap-3 md:items-end">
                          <InstallSnippet
                            prompt={DEBUGGER_PROMPT}
                            fathomEvent="Dashboard copy debugger prompt click"
                          />
                          <button
                            type="button"
                            disabled={busy === "debugger"}
                            onClick={() => void completeDebuggerSetup()}
                            className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busy === "debugger"
                              ? "Saving..."
                              : "I've added the debugger"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "users" && busy !== "session" && (
          <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="overflow-hidden rounded-lg border border-rule bg-panel/70">
              <div className="hidden grid-cols-[1fr_110px_120px] border-b border-rule px-4 py-3 text-xs uppercase text-muted md:grid">
                <span>User</span>
                <span>Role</span>
                <span>Joined</span>
              </div>
              {users?.users.map((user) => (
                <div
                  key={user.id}
                  className="grid gap-3 border-b border-rule px-4 py-3 last:border-b-0 md:grid-cols-[1fr_110px_120px] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {user.name}
                      {user.id === currentUser?.id ? " (you)" : ""}
                    </p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                  </div>
                  <span className="text-sm text-muted">{user.role}</span>
                  <span className="text-xs text-muted">
                    {formatDate(user.created_at)}
                  </span>
                </div>
              ))}
            </div>
            <form
              onSubmit={inviteUser}
              className="h-fit rounded-lg border border-rule bg-panel/70 p-4"
            >
              <h2 className="mb-4 text-base font-medium text-ink">
                Invite user
              </h2>
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
    </div>
  );
}
