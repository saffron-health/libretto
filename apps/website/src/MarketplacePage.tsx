import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
  publicCloudGet,
  type CloudSession,
} from "./cloudApi";
import { withReturnTo } from "./authRedirect";

export type MarketplaceWorkflowSummary = {
  id: string;
  workflow_name: string;
  description: string | null;
  publisher_name: string;
  publisher_slug: string | null;
  credential_names: string[];
  import_available: boolean;
  import_count: number;
  updated_at: string;
};

type MarketplaceWorkflowDetail = MarketplaceWorkflowSummary & {
  files: Array<{ file_name: string; code: string }>;
};

type SecretRow = {
  credential_id: string;
  name: string;
};

type WorkflowBuildStatus = {
  build_id: string;
  status: "deploying" | "ready" | "failed";
  workflow_name: string | null;
  error: string | null;
};

function pageShell(children: React.ReactNode) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[980px] px-4 pb-20 pt-12 md:px-8">
        {children}
      </main>
    </div>
  );
}

export function MarketplacePage() {
  const [workflows, setWorkflows] = useState<
    MarketplaceWorkflowSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicCloudGet<{ workflows: MarketplaceWorkflowSummary[] }>("/marketplace")
      .then((result) => setWorkflows(result.workflows))
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load workflows.",
        ),
      );
  }, []);

  return pageShell(
    <>
      <header className="mb-10 max-w-2xl">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-accent">
          Libretto Marketplace
        </p>
        <h1 className="font-serif text-5xl font-light tracking-[-0.035em] md:text-6xl">
          Reusable browser workflows.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Add a public workflow to your Libretto account, connect your own
          secrets, and get a private cloud deployment.
        </p>
      </header>

      {workflows === null && !error && (
        <p className="text-sm text-muted">Loading workflows…</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-400/30 bg-red-950/20 p-4 text-red-200">
          {error}
        </p>
      )}
      {workflows?.length === 0 && (
        <p className="rounded-xl border border-rule bg-panel p-8 text-muted">
          No public workflows have been shared yet.
        </p>
      )}
      <section className="grid gap-4 md:grid-cols-2">
        {workflows?.map((workflow) => (
          <a
            key={workflow.id}
            href={`/marketplace/${encodeURIComponent(workflow.id)}`}
            className="rounded-xl border border-rule bg-panel p-5 text-ink no-underline transition hover:border-accent/50 hover:bg-panel-hi"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-serif text-2xl font-light">
                {workflow.workflow_name}
              </h2>
              <span className="rounded-full border border-rule px-2 py-1 font-mono text-[10px] uppercase text-muted">
                {workflow.import_count} uses
              </span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">
              {workflow.description ||
                "A shared Libretto workflow ready to configure."}
            </p>
            <p className="mt-5 font-mono text-xs text-accent-bright">
              by {workflow.publisher_name}
            </p>
          </a>
        ))}
      </section>
    </>,
  );
}

export function MarketplaceWorkflowPage({ shareId }: { shareId: string }) {
  const [workflow, setWorkflow] = useState<MarketplaceWorkflowDetail | null>(
    null,
  );
  const [session, setSession] = useState<CloudSession | null>(null);
  const [hasTenant, setHasTenant] = useState(false);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoRepair, setAutoRepair] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [build, setBuild] = useState<WorkflowBuildStatus | null>(null);

  useEffect(() => {
    publicCloudGet<MarketplaceWorkflowDetail>(
      `/marketplace/${encodeURIComponent(shareId)}/data`,
    )
      .then(setWorkflow)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load this workflow.",
        ),
      );
    getCloudSession()
      .then(async (result) => {
        setSession(result);
        if (!result) return;
        const status = await getAuthStatus();
        setHasTenant(status.hasTenant);
        if (!status.hasTenant) return;
        const secretResult = await orpcCall<{ secrets: SecretRow[] }>(
          "/v1/dashboard/secrets",
        );
        setSecrets(secretResult.secrets);
      })
      .catch(() => setSession(null));
  }, [shareId]);

  useEffect(() => {
    if (!build || build.status === "ready" || build.status === "failed") return;
    const timer = window.setInterval(() => {
      orpcCall<WorkflowBuildStatus>("/v1/workflows/buildStatus", {
        build_id: build.build_id,
      })
        .then(setBuild)
        .catch((reason) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not check build status.",
          ),
        );
    }, 3000);
    return () => window.clearInterval(timer);
  }, [build]);

  const savedSecrets = useMemo(
    () => new Map(secrets.map((secret) => [secret.name, secret])),
    [secrets],
  );

  function startUsingWorkflow() {
    const returnTo = `/marketplace/${encodeURIComponent(shareId)}`;
    if (!session) {
      window.location.assign(withReturnTo("/signin", returnTo));
      return;
    }
    if (!hasTenant) {
      window.location.assign(withReturnTo("/onboarding", returnTo));
      return;
    }
    setConfiguring(true);
  }

  async function importWorkflow(event: FormEvent) {
    event.preventDefault();
    if (!workflow) return;
    setBusy(true);
    setError(null);
    try {
      const credentialIds: string[] = [];
      for (const name of workflow.credential_names) {
        const saved = savedSecrets.get(name);
        if (saved) {
          credentialIds.push(saved.credential_id);
          continue;
        }
        const value = values[name];
        if (!value || value.trim().length === 0) {
          throw new Error(`Enter a value for ${name}.`);
        }
        const created = await orpcCall<{ credential_id: string }>(
          "/v1/dashboard/createSecret",
          { name, value },
        );
        credentialIds.push(created.credential_id);
      }
      const result = await orpcCall<{
        build_id: string;
        status: "deploying";
        workflow_name: string;
      }>("/v1/marketplace/import", {
        share_id: workflow.id,
        credential_ids: credentialIds,
        auto_repair: autoRepair,
      });
      setBuild({
        build_id: result.build_id,
        status: result.status,
        workflow_name: result.workflow_name,
        error: null,
      });
      setConfiguring(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not use this workflow.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!workflow) {
    return pageShell(
      <p className={error ? "text-red-200" : "text-muted"}>
        {error || "Loading workflow…"}
      </p>,
    );
  }

  return pageShell(
    <>
      <a
        href="/marketplace"
        className="font-mono text-xs text-muted hover:text-ink"
      >
        ← Marketplace
      </a>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">
            Shared by {workflow.publisher_name}
          </p>
          <h1 className="mt-3 font-serif text-5xl font-light tracking-[-0.035em]">
            {workflow.workflow_name}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
            {workflow.description ||
              "A public Libretto workflow you can add to your account."}
          </p>
          <p className="mt-3 max-w-2xl text-xs leading-6 text-muted">
            Review the shared source and package.json dependencies before
            importing. Marketplace workflows run publisher-provided code in your
            private deployment.
          </p>
          <div className="mt-8 space-y-4">
            {workflow.files.map((file) => (
              <details
                key={file.file_name}
                className="rounded-xl border border-rule bg-panel"
                open={workflow.files.length === 1}
              >
                <summary className="cursor-pointer px-4 py-3 font-mono text-xs text-muted">
                  {file.file_name}
                </summary>
                <pre className="max-h-[520px] overflow-auto border-t border-rule p-4 text-xs leading-6 text-ink">
                  <code>{file.code}</code>
                </pre>
              </details>
            ))}
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-rule bg-panel p-5 lg:sticky lg:top-24">
          {build ? (
            <div>
              <p className="font-mono text-xs uppercase text-accent">
                {build.status === "ready"
                  ? "Workflow ready"
                  : build.status === "failed"
                    ? "Build failed"
                    : "Build in progress"}
              </p>
              <h2 className="mt-3 font-serif text-2xl font-light">
                {build.workflow_name || workflow.workflow_name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                {build.status === "deploying"
                  ? "The workflow was copied and its private cloud deployment is being built. You can leave this page; it also appears on your Workflows dashboard."
                  : build.status === "ready"
                    ? "Your private workflow is deployed and available in Libretto and the Chrome extension."
                    : build.error || "The workflow could not be built."}
              </p>
              <a
                href="/dashboard/workflows"
                className="libretto-button libretto-button--default mt-5 inline-flex h-10 items-center no-underline"
              >
                View workflows
              </a>
            </div>
          ) : configuring ? (
            <form onSubmit={importWorkflow}>
              <p className="font-mono text-xs uppercase text-accent">
                Configure workflow
              </p>
              <h2 className="mt-3 font-serif text-2xl font-light">
                Connect your secrets
              </h2>
              {workflow.credential_names.length === 0 ? (
                <p className="mt-3 text-sm leading-6 text-muted">
                  This workflow does not require any saved secrets. Workflow
                  parameters are entered each time you run it.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {workflow.credential_names.map((name) => {
                    const saved = savedSecrets.get(name);
                    return (
                      <label key={name} className="block">
                        <span className="mb-2 block font-mono text-xs text-muted">
                          {name}
                        </span>
                        {saved ? (
                          <span className="block rounded-md border border-accent/30 bg-green-3/20 px-3 py-2 text-sm text-accent-bright">
                            Using saved secret
                          </span>
                        ) : (
                          <input
                            type="password"
                            required
                            autoComplete="off"
                            value={values[name] || ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [name]: event.target.value,
                              }))
                            }
                            placeholder="Stored encrypted"
                            className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm outline-none focus:border-accent"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              <label className="mt-5 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={autoRepair}
                  onChange={(event) => setAutoRepair(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm text-ink">
                    Automatically repair failed runs
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    When a hosted run fails, Libretto can attempt to fix the
                    workflow. Turn this off for a private deployment that only
                    reports failures.
                  </span>
                </span>
              </label>
              <button
                disabled={busy}
                className="libretto-button libretto-button--default mt-5 h-10 w-full"
              >
                {busy ? "Starting build…" : "Generate my workflow"}
              </button>
              <button
                type="button"
                onClick={() => setConfiguring(false)}
                className="mt-2 h-9 w-full text-xs text-muted"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div>
              <p className="font-mono text-xs uppercase text-accent">
                Private copy
              </p>
              <h2 className="mt-3 font-serif text-2xl font-light">
                Use this workflow
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Sign in, connect your own secrets, and build a private
                deployment. Parameters are entered when you run it.
              </p>
              <button
                type="button"
                onClick={startUsingWorkflow}
                disabled={!workflow.import_available}
                className="libretto-button libretto-button--default mt-5 h-10 w-full"
              >
                {session ? "Use this workflow" : "Sign in to use workflow"}
              </button>
              {!workflow.import_available && (
                <p className="mt-3 text-xs leading-5 text-red-200">
                  The publisher must update this shared workflow before it can
                  be imported.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="mt-4 text-xs leading-5 text-red-200">{error}</p>
          )}
        </aside>
      </div>
    </>,
  );
}
