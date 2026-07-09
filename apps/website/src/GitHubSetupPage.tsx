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

function currentReturnTo(): string {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function GitHubSetupPage() {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const installationId = params.get("installation_id")?.trim();

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
            await orpcCall<InstallationRepositoriesResponse>(
              "/v1/github/syncInstallation",
              { installation_id: installationId },
            );
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
      <main className="mx-auto w-full max-w-[980px] px-4 py-8 md:px-8">
        <div className="mb-7 border-b border-rule pb-6">
          <p className="mb-2 font-mono text-xs uppercase text-accent">
            Libretto setup
          </p>
          <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
            Finish setup
          </h1>
        </div>

        {checking ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-10 text-center text-sm text-muted">
            Checking account...
          </div>
        ) : (
          ready && (
            <section className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="mb-2 font-mono text-xs uppercase text-accent">
                    Step 2 of 2
                  </p>
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                    <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                    Connect a GitHub repository
                  </h2>
                  <p className="mt-2 max-w-[620px] text-sm text-muted">
                    Let Libretto open PRs when scripts break.
                  </p>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                  {installationId ? (
                    <button
                      type="button"
                      disabled
                      className="libretto-button libretto-button--sm inline-flex h-9 min-w-[168px] cursor-wait items-center justify-center whitespace-nowrap px-4 opacity-80"
                    >
                      Connecting GitHub...
                    </button>
                  ) : (
                    <a
                      href="/setup"
                      className="libretto-button libretto-button--sm inline-flex h-9 min-w-[148px] items-center justify-center whitespace-nowrap px-4"
                    >
                      Return to setup
                    </a>
                  )}
                </div>
              </div>

              {!installationId && (
                <p className="mt-4 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm leading-5 text-amber-bright">
                  No GitHub installation callback was found. Start from setup to
                  connect GitHub.
                </p>
              )}
              {error && (
                <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                  {error}
                </p>
              )}
            </section>
          )
        )}
      </main>
    </div>
  );
}
