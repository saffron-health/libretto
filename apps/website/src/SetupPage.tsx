import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navbar } from "./components/Navbar";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  createApiKey,
  getAuthStatus,
  getCloudSession,
  getSetupStatus,
  listLinkedRepositories,
  updateSetupStatus,
  type LinkedRepository,
  type SetupStatus,
} from "./cloudApi";
import { GitHubIcon } from "./icons";

const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";
const DEBUGGER_DOCS_URL = "/docs/reference/runtime/playwright-debugger";
const DEBUGGER_CONCEPT_URL = "/docs/understand-libretto/autofix-debugging";
const DEBUGGER_PROMPT =
  "Add the Libretto Playwright debugging agent to my existing automation. " +
  "Install libretto-playwright-debugger, then follow " +
  "https://libretto.sh/docs/reference/runtime/playwright-debugger. Create a " +
  "module-scope playwrightDebugger with createPlaywrightDebugger, my repo " +
  "(owner, repo, baseBranch), and model configuration, using LIBRETTO_API_KEY " +
  "for GitHub authentication. At the existing failure point, before " +
  "Playwright teardown, call await " +
  "playwrightDebugger.debugFailure(error, page) with the live page that " +
  "observed the failure. Keep my existing workflow, fallbacks, retries, " +
  "logging, and rethrow behavior in place.";
const CLOUD_SETUP_PROMPT =
  "Fetch and follow https://libretto.sh/cloud.md to set up Libretto Cloud hosted browsers for this project.";
const CLOUD_SETUP_COMPLETE_KEY = "libretto.setup.cloudSetupComplete";
const CLOUD_SETUP_DISMISSED_KEY = "libretto.dashboard.cloudSetupDismissed";

type Screen =
  | "intro"
  | "github"
  | "confirm"
  | "apikey"
  | "debugger"
  | "cloudApiKey"
  | "cloud"
  | "cloudDone"
  | "done";

// Where each screen's "Back" goes. GitHub can't be un-linked, so the repo
// confirmation steps back to the first step rather than the connect screen.
const BACK_TARGET: Record<Screen, Screen | null> = {
  intro: null,
  github: "intro",
  confirm: "intro",
  apikey: "confirm",
  debugger: "apikey",
  cloudApiKey: "intro",
  cloud: "cloudApiKey",
  cloudDone: null,
  done: null,
};

const ACTION_BUTTON_CLASS =
  "libretto-button libretto-button--sm inline-flex h-9 min-w-[120px] items-center justify-center whitespace-nowrap px-4 disabled:cursor-not-allowed disabled:opacity-60";
const WIDE_ACTION_BUTTON_CLASS =
  "libretto-button libretto-button--sm inline-flex h-9 min-w-[220px] items-center justify-center whitespace-nowrap px-4 disabled:cursor-not-allowed disabled:opacity-60";
const NAV_BUTTON_CLASS =
  "w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-60";

function getInitialSetupStep(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("step");
}

export function SetupPage() {
  const [checking, setChecking] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [linkedRepos, setLinkedRepos] = useState<LinkedRepository[] | null>(
    null,
  );
  const [manualScreen, setManualScreen] = useState<Screen | null>(null);

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
            err instanceof Error ? err.message : "Could not load account status.",
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
          const initialStep = getInitialSetupStep();
          setSetupStatus(setup);
          if (
            initialStep === "github-repositories" &&
            setup.github_repository_linked
          ) {
            setManualScreen("confirm");
          }
        } catch (err) {
          setSetupStatus({
            local_agent_setup_complete: false,
            github_repository_linked: false,
            linked_repository_count: 0,
            api_key_created: false,
            debugger_added: false,
            setup_complete: false,
          });
          setError(
            err instanceof Error ? err.message : "Could not load setup status.",
          );
        }
        setChecking(false);
      } catch {
        window.location.assign("/signin?mode=signup");
      }
    }

    void loadSetup();
  }, []);

  const githubLinked = setupStatus?.github_repository_linked === true;
  useEffect(() => {
    if (!githubLinked) return;
    let cancelled = false;
    listLinkedRepositories()
      .then((res) => {
        if (!cancelled) setLinkedRepos(res.repositories);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [githubLinked]);

  async function patchSetup(input: Parameters<typeof updateSetupStatus>[0]) {
    setSavingStep(true);
    setError(null);
    try {
      const updated = await updateSetupStatus(input);
      setSetupStatus(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update setup.");
      return null;
    } finally {
      setSavingStep(false);
    }
  }

  async function mintApiKey(name = "Libretto autofix") {
    setSavingStep(true);
    setError(null);
    try {
      const created = await createApiKey(name);
      setMintedKey(created.key);
      setKeyCopied(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create an API key.",
      );
    } finally {
      setSavingStep(false);
    }
  }

  async function confirmApiKeySaved() {
    const updated = await patchSetup({ api_key_created: true });
    if (updated) {
      setMintedKey(null);
      setKeyCopied(false);
      setManualScreen("debugger");
    }
  }

  async function confirmCloudApiKeySaved() {
    const updated = await patchSetup({ api_key_created: true });
    if (updated) {
      setMintedKey(null);
      setKeyCopied(false);
      setManualScreen("cloud");
    }
  }

  async function completeDebuggerSetup() {
    const updated = await patchSetup({ debugger_added: true });
    if (updated) {
      setManualScreen("done");
    }
  }

  function copyMintedKey() {
    if (!mintedKey) return;
    void navigator.clipboard.writeText(mintedKey).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  }

  const githubDone = setupStatus?.github_repository_linked === true;
  const apiKeyDone = setupStatus?.api_key_created === true;
  const debuggerDone = setupStatus?.debugger_added === true;

  const prSetupComplete = githubDone && apiKeyDone && debuggerDone;
  const derivedScreen: Screen = prSetupComplete ? "done" : "intro";
  const screen = manualScreen ?? derivedScreen;

  function goBack() {
    const target = BACK_TARGET[screen];
    if (target) setManualScreen(target);
  }

  function startPrAgentSetup() {
    setManualScreen(githubDone ? "confirm" : "github");
  }

  function startCloudSetup() {
    setManualScreen("cloudApiKey");
  }

  function completeCloudSetup() {
    window.localStorage.setItem(CLOUD_SETUP_COMPLETE_KEY, "1");
    window.localStorage.setItem(CLOUD_SETUP_DISMISSED_KEY, "1");
    setManualScreen("cloudDone");
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[980px] px-4 py-8 md:px-8">
        <div className="mb-7 flex flex-col gap-4 border-b border-rule pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 font-mono text-xs uppercase text-accent">
              Libretto setup
            </p>
            <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
              Finish setup
            </h1>
          </div>
          <a
            href="/dashboard"
            className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
          >
            Go to dashboard
          </a>
        </div>

        {checking ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-10 text-center text-sm text-muted">
            Loading account...
          </div>
        ) : (
          <>
            <section className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
            {screen === "intro" && (
              <div className="grid gap-5">
                <div>
                  <div className="min-w-0">
                    <AreaLabel title="PR autofix agent setup" />
                    <h2 className="text-lg font-semibold text-ink">
                      Set up Libretto PR agents
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      Start by connecting the GitHub repository where your
                      automations live. Libretto uses this connection to open
                      scoped fix pull requests when those scripts break.
                    </p>
                  </div>
                </div>

                <div className="border-t border-rule/50 pt-2">
                  <p className="text-sm leading-6 text-muted">
                    PR autofix agents work with any browser runtime or cloud
                    provider. Add the Playwright debugger to your automation,
                    and Libretto can inspect failures from your runs and open
                    scoped pull requests for you to review.
                  </p>
                </div>
                <div className="flex justify-end border-t border-rule/50 pt-4">
                  {githubDone ? (
                    <button
                      type="button"
                      onClick={startPrAgentSetup}
                      className={WIDE_ACTION_BUTTON_CLASS}
                    >
                      Continue setup →
                    </button>
                  ) : (
                    <a
                      href={GITHUB_APP_INSTALL_URL}
                      className={WIDE_ACTION_BUTTON_CLASS}
                    >
                      Connect GitHub for PR agents →
                    </a>
                  )}
                </div>
              </div>
            )}

            {screen === "github" && !githubDone && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="PR autofix agent setup" />
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                    <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                    Connect GitHub for Libretto PR agents
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Install the Libretto GitHub App on the repo that holds your
                    automations. Libretto uses that GitHub connection to open
                    scoped fix pull requests when a script fails, so you review
                    changes instead of debugging from scratch. Choose the
                    account or org that owns the target repository.
                  </p>
                </div>
                <StepFooter
                  onBack={goBack}
                  next={
                    <a href={GITHUB_APP_INSTALL_URL} className={ACTION_BUTTON_CLASS}>
                      Connect GitHub
                    </a>
                  }
                />
              </div>
            )}

            {screen === "confirm" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="PR autofix agent setup" />
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                    <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                    {linkedRepos && linkedRepos.length > 0
                      ? `Connected ${linkedRepos.length} ${
                          linkedRepos.length === 1 ? "repository" : "repositories"
                        }`
                      : "Repository connected"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Libretto will open autofix pull requests on the repositories
                    below. Next you&apos;ll generate an API key so your
                    automation can request those PRs.
                  </p>
                </div>
                {linkedRepos === null ? (
                  <p className="text-sm text-muted">Loading repositories...</p>
                ) : linkedRepos.length > 0 ? (
                  <ul className="grid gap-2">
                    {linkedRepos.map((repo) => (
                      <li
                        key={repo.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border border-rule bg-panel/60 px-3.5 py-2.5 md:flex md:items-center md:gap-3"
                      >
                        <RepoIcon className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 truncate text-sm">
                          <span className="text-muted">{repo.owner}</span>
                          <span className="text-muted"> / </span>
                          <span className="font-semibold text-ink">
                            {repo.name}
                          </span>
                        </span>
                        <span className="col-start-2 w-fit shrink-0 rounded-full border border-rule px-2 py-0.5 text-[11px] font-medium text-muted md:ml-auto">
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <a
                  href={GITHUB_APP_INSTALL_URL}
                  className="w-fit text-xs text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
                >
                  Add another repository
                </a>
                <StepFooter
                  onBack={goBack}
                  next={
                    <button
                      type="button"
                      onClick={() => {
                        setManualScreen("apikey");
                      }}
                      className={NAV_BUTTON_CLASS}
                    >
                      Next →
                    </button>
                  }
                />
              </div>
            )}

            {screen === "apikey" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="PR autofix agent setup" />
                  <h2 className="text-lg font-semibold text-ink">
                    Generate a Libretto API key
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Your automation uses this key to talk to Libretto Cloud.
                    When a run fails, Libretto exchanges it for a short-lived,
                    repo-scoped GitHub token to open the fix PR, so you never
                    store a raw GitHub token. Save it as{" "}
                    <code className="rounded bg-ink/10 px-1 py-0.5 font-mono text-xs">
                      LIBRETTO_API_KEY
                    </code>{" "}
                    in your project&apos;s <code className="font-mono">.env</code>.
                  </p>
                </div>

                {mintedKey ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-stretch gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md border border-rule bg-bg/70 px-3 py-2 font-mono text-xs text-ink">
                        {mintedKey}
                      </code>
                      <button
                        type="button"
                        onClick={copyMintedKey}
                        className="libretto-button libretto-button--sm inline-flex h-auto shrink-0 items-center justify-center whitespace-nowrap px-4"
                      >
                        {keyCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-amber-300/90">
                      Copy this now, it is shown only once. Add it to your
                      project&apos;s <code>.env</code> as{" "}
                      <code className="font-mono">LIBRETTO_API_KEY</code>.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-2">
                    <button
                      type="button"
                      disabled={savingStep}
                      onClick={() => void mintApiKey()}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {savingStep ? "Generating..." : "Generate API key"}
                    </button>
                    <span className="text-xs text-muted">
                      Already have a key? Just press Next.
                    </span>
                  </div>
                )}
                <StepFooter
                  onBack={goBack}
                  next={
                    <button
                      type="button"
                      disabled={savingStep}
                      onClick={() => void confirmApiKeySaved()}
                      className={NAV_BUTTON_CLASS}
                    >
                      {savingStep ? "Saving..." : "Next →"}
                    </button>
                  }
                />
              </div>
            )}

            {screen === "debugger" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="PR autofix agent setup" />
                  <h2 className="text-lg font-semibold text-ink">
                    Add the debugger to your Playwright script
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Initialize the Playwright debugger once. At your
                    automation&apos;s existing failure point (its{" "}
                    <code className="rounded bg-ink/10 px-1 py-0.5 font-mono text-xs">
                      catch
                    </code>{" "}
                    block), call{" "}
                    <code className="rounded bg-ink/10 px-1 py-0.5 font-mono text-xs">
                      playwrightDebugger.debugFailure(error, page)
                    </code>{" "}
                    before teardown. On the next failure, Libretto investigates
                    the live page and opens a fix PR on your connected repo.
                    Paste this prompt into your coding agent to wire it in:
                  </p>
                </div>
                <div className="flex flex-col items-start">
                  <InstallSnippet
                    prompt={DEBUGGER_PROMPT}
                    fathomEvent="Setup copy debugger prompt click"
                  />
                </div>
                <p className="text-xs leading-5 text-muted">
                  Learn more:{" "}
                  <a
                    href={DEBUGGER_DOCS_URL}
                    className="text-accent-bright underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                  >
                    runtime reference
                  </a>{" "}
                  ·{" "}
                  <a
                    href={DEBUGGER_CONCEPT_URL}
                    className="text-accent-bright underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                  >
                    Playwright debugging agent
                  </a>
                </p>
                <StepFooter
                  onBack={goBack}
                  next={
                    <button
                      type="button"
                      disabled={savingStep}
                      onClick={() => void completeDebuggerSetup()}
                      className={WIDE_ACTION_BUTTON_CLASS}
                    >
                      {savingStep ? "Saving..." : "Finish PR agents setup →"}
                    </button>
                  }
                />
              </div>
            )}

            {screen === "cloudApiKey" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="Libretto Cloud setup" />
                  <h2 className="text-lg font-semibold text-ink">
                    Generate a Libretto API key
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Hosted browser runs use your Libretto API key to authenticate
                    from your local project. Save it as{" "}
                    <code className="rounded bg-ink/10 px-1 py-0.5 font-mono text-xs">
                      LIBRETTO_API_KEY
                    </code>{" "}
                    before copying the Cloud setup prompt.
                  </p>
                </div>

                {mintedKey ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-stretch gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md border border-rule bg-bg/70 px-3 py-2 font-mono text-xs text-ink">
                        {mintedKey}
                      </code>
                      <button
                        type="button"
                        onClick={copyMintedKey}
                        className="libretto-button libretto-button--sm inline-flex h-auto shrink-0 items-center justify-center whitespace-nowrap px-4"
                      >
                        {keyCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-amber-300/90">
                      Copy this now, it is shown only once. Add it to your
                      project&apos;s <code>.env</code> as{" "}
                      <code className="font-mono">LIBRETTO_API_KEY</code>.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-2">
                    <button
                      type="button"
                      disabled={savingStep}
                      onClick={() => void mintApiKey("Libretto Cloud")}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {savingStep ? "Generating..." : "Generate API key"}
                    </button>
                    <span className="text-xs text-muted">
                      Already have a key? Just press Next.
                    </span>
                  </div>
                )}
                <StepFooter
                  onBack={goBack}
                  next={
                    <button
                      type="button"
                      disabled={savingStep}
                      onClick={() => void confirmCloudApiKeySaved()}
                      className={NAV_BUTTON_CLASS}
                    >
                      {savingStep ? "Saving..." : "Next →"}
                    </button>
                  }
                />
              </div>
            )}

            {screen === "cloud" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="Libretto Cloud setup" />
                  <h2 className="text-lg font-semibold text-ink">
                    Set up hosted browser runs
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Cloud browsers are optional. Copy this prompt into your local
                    coding agent when you want hosted runs for this project.
                  </p>
                </div>
                <div className="flex flex-col items-start">
                  <InstallSnippet
                    prompt={CLOUD_SETUP_PROMPT}
                    fathomEvent="Setup copy cloud setup prompt click"
                  />
                </div>
                <StepFooter
                  onBack={goBack}
                  next={
                    <button
                      type="button"
                      onClick={completeCloudSetup}
                      className={WIDE_ACTION_BUTTON_CLASS}
                    >
                      Finish setup →
                    </button>
                  }
                />
              </div>
            )}

            {screen === "cloudDone" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="Libretto Cloud setup" />
                  <h2 className="text-lg font-semibold text-ink">
                    Cloud browsers setup complete
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Your local project has the API key and prompt needed to run
                    workflows on hosted Libretto Cloud browsers.
                  </p>
                </div>
                <StepFooter
                  next={
                    <a
                      href="/dashboard/cloud-browsers"
                      className={ACTION_BUTTON_CLASS}
                    >
                      Open Cloud browsers →
                    </a>
                  }
                />
              </div>
            )}

            {screen === "done" && (
              <div className="grid gap-5">
                <div>
                  <AreaLabel title="PR autofix agent setup" />
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                    <GitHubIcon className="size-5 shrink-0 text-accent-bright" />
                    Setup complete
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Your PR autofix agent is ready. When a script fails, Libretto
                    can investigate the live page and open a fix PR on your
                    connected repo. Cloud browsers are optional and can be set up
                    separately.
                  </p>
                </div>
                <StepFooter
                  next={
                    <a
                      href="/dashboard"
                      className={ACTION_BUTTON_CLASS}
                    >
                      Open PR agents dashboard →
                    </a>
                  }
                />
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                {error}
              </p>
            )}
            </section>

            {screen === "intro" && (
              <section className="mt-4 rounded-md border border-rule bg-panel/55 px-4 py-3 text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="mb-1 font-mono text-[11px] uppercase text-muted">
                      Need cloud browsers?
                    </p>
                    <h2 className="text-sm font-semibold text-ink">
                      Cloud browsers
                    </h2>
                    <p className="mt-1 max-w-[760px] text-xs leading-5 text-muted">
                      Libretto Cloud hosts browser runs for you and includes
                      autofix plus email alerts when runs fail. Use it if you
                      want Libretto-managed hosting instead of your own cloud
                      provider or local machine.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startCloudSetup}
                    className="inline-flex h-9 w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-rule bg-panel/70 px-4 font-mono text-xs uppercase tracking-0 text-muted transition-colors hover:border-accent/45 hover:text-ink"
                  >
                    Set up Cloud browsers
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function BackButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={NAV_BUTTON_CLASS}
    >
      ← Back
    </button>
  );
}

function StepFooter({
  onBack,
  next,
}: {
  onBack?: () => void;
  next: ReactNode;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3 border-t border-rule/50 pt-4">
      {onBack ? <BackButton onClick={onBack} /> : <span />}
      {next}
    </div>
  );
}

function AreaLabel({ title }: { title: string }) {
  return (
    <p className="mb-2 font-mono text-xs uppercase text-accent">
      {title}
    </p>
  );
}

// GitHub "repo" octicon — matches the icon GitHub uses in repository lists.
function RepoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z" />
      <path d="M5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}
