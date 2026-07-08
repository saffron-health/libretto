import { useEffect, useMemo, useState } from "react";
import { withReturnTo } from "./authRedirect";
import { Navbar } from "./components/Navbar";
import { getAuthStatus, getCloudSession, orpcCall } from "./cloudApi";
import { GitHubIcon } from "./icons";

type GitHubRepository = {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
};

type InstallationRepositoriesResponse = {
  installation: {
    id: string;
    account_login: string;
    account_type: string;
    repository_selection: string;
  };
  repositories: GitHubRepository[];
};

const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";

function currentReturnTo(): string {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function GitHubSetupPage() {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [installation, setInstallation] =
    useState<InstallationRepositoriesResponse["installation"] | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const installationId = params.get("installation_id")?.trim();
  const setupAction = params.get("setup_action")?.trim();

  useEffect(() => {
    async function loadGitHubSetup() {
      const returnTo = currentReturnTo();
      try {
        const session = await getCloudSession();
        if (!session) {
          window.location.assign(withReturnTo("/signin?mode=signup", returnTo));
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
          setReady(true);
          setChecking(false);
          return;
        }
        if (!status.emailVerified) {
          window.location.assign(withReturnTo("/verify-email", returnTo));
          return;
        }
        if (!status.hasTenant) {
          window.location.assign(withReturnTo("/onboarding", returnTo));
          return;
        }

        setReady(true);
        setChecking(false);

        if (installationId) {
          try {
            const result = await orpcCall<InstallationRepositoriesResponse>(
              "/v1/github/syncInstallation",
              { installation_id: installationId },
            );
            setInstallation(result.installation);
            setRepositories(result.repositories);
            window.location.assign("/dashboard");
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "GitHub installation sync failed.",
            );
          }
        }
      } catch {
        window.location.assign(withReturnTo("/signin?mode=signup", currentReturnTo()));
      }
    }

    void loadGitHubSetup();
  }, [installationId]);

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[980px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_430px] md:items-center">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Libretto Agent
            </p>
            <h1 className="crt-glow max-w-[600px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[58px]">
              Connect GitHub PRs.
            </h1>
            <p className="mt-6 max-w-[520px] text-sm leading-6 text-muted">
              Sign in to Libretto Cloud, install the public GitHub App, then
              link a repository to your workspace so Libretto can open scoped PRs
              when scripts break.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {checking ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking account...
              </div>
            ) : (
              ready && (
                <div className="space-y-5">
                  {setupAction === "request" && (
                    <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm leading-5 text-amber-bright">
                      Installation was requested from a GitHub organization
                      admin. Return here after the request is approved.
                    </p>
                  )}
                  {installationId && installation && (
                    <p className="rounded-md border border-rule bg-bg/70 px-3 py-2 font-mono text-xs text-muted">
                      {installation.account_login} installation {installation.id}{" "}
                      connected. Returning to dashboard...
                    </p>
                  )}

                  {!installationId ? (
                    <a
                      href={GITHUB_APP_INSTALL_URL}
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-rule bg-bg/70 px-4 text-sm font-medium text-ink shadow-sm shadow-black/20 transition-colors hover:border-accent/45 hover:bg-panel-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                    >
                      <span className="grid size-6 place-items-center rounded-full bg-ink text-bg">
                        <GitHubIcon className="size-4" />
                      </span>
                      Install Libretto Agent
                    </a>
                  ) : !installation ? (
                    <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                      Connecting GitHub...
                    </div>
                  ) : repositories.length === 0 && !error ? (
                    <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                      GitHub connected. No repositories are currently selected for
                      this installation.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs uppercase text-muted">
                        Repositories from GitHub
                      </p>
                      {repositories.map((repository) => {
                        return (
                          <div
                            key={repository.id}
                            className="flex flex-col gap-3 rounded-md border border-rule bg-bg/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm text-ink">
                                {repository.full_name}
                              </p>
                              <p className="text-xs text-muted">
                                {repository.private ? "Private" : "Public"}
                              </p>
                            </div>
                            <span className="rounded-full border border-accent/30 px-3 py-1 text-xs text-accent-bright">
                              Linked
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            )}

            {error && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                {error}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
