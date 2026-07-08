import { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  getAuthStatus,
  getCloudSession,
  getSetupStatus,
  updateSetupStatus,
  type SetupStatus,
} from "./cloudApi";
import { GitHubIcon } from "./icons";

const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";

function getLocalAgentStepComplete(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("libretto.dashboard.localAgentSetup") === "1";
}

export function SetupPage() {
  const [checking, setChecking] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSetup() {
      try {
        const session = await getCloudSession();
        if (!session) {
          window.location.assign("/signin?mode=signup");
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
          setChecking(false);
          return;
        }
        if (!status.emailVerified) {
          window.location.assign("/verify-email");
          return;
        }
        if (!status.hasTenant) {
          window.location.assign("/onboarding");
          return;
        }

        try {
          const setup = await getSetupStatus();
          const hasLocalStorageCompletion = getLocalAgentStepComplete();
          if (hasLocalStorageCompletion && !setup.local_agent_setup_complete) {
            const updated = await updateSetupStatus({
              local_agent_setup_complete: true,
            });
            setSetupStatus(updated);
          } else {
            setSetupStatus(setup);
          }
        } catch (err) {
          setSetupStatus({
            local_agent_setup_complete: false,
            github_repository_linked: false,
            linked_repository_count: 0,
            setup_complete: false,
          });
          setError(
            err instanceof Error
              ? err.message
              : "Could not load setup status.",
          );
        }
        setChecking(false);
      } catch {
        window.location.assign("/signin?mode=signup");
      }
    }

    void loadSetup();
  }, []);

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

  const localAgentSetupComplete =
    setupStatus?.local_agent_setup_complete === true;
  const githubRepositoryLinked = setupStatus?.github_repository_linked === true;

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
            Loading account...
          </div>
        ) : (
          <section className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
            {!localAgentSetupComplete ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div>
                  <p className="mb-2 font-mono text-xs uppercase text-accent">
                    Step 1 of 2
                  </p>
                  <h2 className="text-lg font-semibold text-ink">
                    Set up your local agent
                  </h2>
                </div>
                <div className="flex min-w-0 flex-col gap-3 md:items-end">
                  <InstallSnippet
                    fathomEvent="Setup copy local setup prompt click"
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
            ) : githubRepositoryLinked ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="mb-2 font-mono text-xs uppercase text-accent">
                    Setup complete
                  </p>
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                    <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                    Local agent and GitHub are connected
                  </h2>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                  <a
                    href="/dashboard/cloud-browsers"
                    className="libretto-button libretto-button--sm inline-flex h-9 min-w-[128px] items-center justify-center whitespace-nowrap px-4"
                  >
                    Open cloud
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
            ) : (
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
                  <a
                    href={GITHUB_APP_INSTALL_URL}
                    className="libretto-button libretto-button--sm inline-flex h-9 min-w-[148px] items-center justify-center whitespace-nowrap px-4"
                  >
                    Connect GitHub
                  </a>
                  <button
                    type="button"
                    onClick={showLocalAgentSetup}
                    className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
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
          </section>
        )}
      </main>
    </div>
  );
}
