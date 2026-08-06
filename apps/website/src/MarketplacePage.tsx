import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "./components/Button";
import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import { Text } from "./components/Text";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
  publicCloudGet,
  cloudApiUrl,
  type CloudSession,
} from "./cloudApi";
import { withReturnTo } from "./authRedirect";
import { Prism } from "./prism";

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

const CODE_TOKEN_CLASSES =
  "font-mono text-[13px] leading-6 text-ink [&_.token.boolean]:text-[#79c0ff] [&_.token.builtin]:text-[#ffa657] [&_.token.class-name]:text-[#ffa657] [&_.token.comment]:text-[#8b949e] [&_.token.function]:text-[#d2a8ff] [&_.token.keyword]:text-[#ff7b72] [&_.token.number]:text-[#79c0ff] [&_.token.operator]:text-[#ff7b72] [&_.token.property]:text-[#79c0ff] [&_.token.punctuation]:text-[#c9d1d9] [&_.token.string]:text-[#a5d6ff] [&_.token.variable]:text-[#ffa657]";

function pageShell(children: React.ReactNode) {
  return (
    <div className="crt-page flex min-h-screen flex-col bg-bg text-ink">
      <Navbar />
      <main className="section-rails relative mx-auto mt-16 flex w-full max-w-[1100px] flex-1 flex-col px-4 pb-20 md:px-8">
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}

function matchesQuery(
  workflow: MarketplaceWorkflowSummary,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    workflow.workflow_name,
    workflow.description ?? "",
    workflow.publisher_name,
    workflow.publisher_slug ?? "",
    ...workflow.credential_names,
  ]
    .join(" ")
    .toLowerCase();
  return needle
    .split(/\s+/u)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

function highlightCode(fileName: string, code: string): string {
  if (/\.json$/iu.test(fileName) && Prism.languages.json) {
    return Prism.highlight(code, Prism.languages.json, "json");
  }
  if (/\.[cm]?[tj]sx?$/iu.test(fileName) && Prism.languages.typescript) {
    return Prism.highlight(code, Prism.languages.typescript, "typescript");
  }
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildCliSetupPrompt(args: {
  workflowName: string;
  codeUrl: string;
}): string {
  return [
    `Use this Libretto workflow code as a starting point: ${args.codeUrl}`,
    "",
    "Fetch the code from that public URL. If it contains `// File:` sections, split them into matching local files. If Libretto is not set up, fetch and follow https://libretto.sh/start.md. Ensure the workflow file you run has a default workflow export, then install dependencies and run it locally with `libretto run`.",
  ].join("\n");
}

export function MarketplacePage() {
  const [workflows, setWorkflows] = useState<
    MarketplaceWorkflowSummary[] | null
  >(null);
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(
    () => (workflows ?? []).filter((workflow) => matchesQuery(workflow, query)),
    [workflows, query],
  );

  return pageShell(
    <>
      <header className="mb-10 max-w-2xl pt-4">
        <Text
          as="p"
          size="xs"
          className="mb-4 uppercase tracking-[0.18em] text-accent"
        >
          Libretto Marketplace
        </Text>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          wrap="balance"
          className="font-[300] leading-[1.05] tracking-[-0.035em] text-ink"
        >
          Reusable browser workflows.
        </Text>
        <Text as="p" size="md" className="mt-5 max-w-xl leading-7 text-muted">
          Browse public workflows, connect your secrets, and deploy a private
          copy to your Libretto account.
        </Text>
      </header>

      <div className="mb-8 max-w-xl">
        <label className="relative block">
          <span className="sr-only">Search workflows</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center font-mono text-sm text-faint"
          >
            /
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, publisher, or secret…"
            className="h-11 w-full rounded-lg border border-rule bg-panel py-2 pr-4 pl-8 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/45 focus:bg-panel-hi focus:shadow-[0_0_0_3px_rgba(18,206,65,0.08)]"
          />
        </label>
        {workflows && (
          <p className="mt-3 font-mono text-[11px] tracking-wide text-faint">
            {filtered.length} of {workflows.length}{" "}
            {workflows.length === 1 ? "workflow" : "workflows"}
          </p>
        )}
      </div>

      {workflows === null && !error && (
        <p className="text-sm text-muted">Loading workflows…</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-400/30 bg-red-950/20 p-4 text-red-200">
          {error}
        </p>
      )}
      {workflows?.length === 0 && (
        <p className="rounded-lg border border-rule bg-panel p-8 text-muted">
          No public workflows have been shared yet.
        </p>
      )}
      {workflows && workflows.length > 0 && filtered.length === 0 && (
        <p className="rounded-lg border border-rule bg-panel p-8 text-muted">
          No workflows match “{query.trim()}”.
        </p>
      )}

      <section className="grid gap-3 md:grid-cols-2">
        {filtered.map((workflow) => (
          <a
            key={workflow.id}
            href={`/marketplace/${encodeURIComponent(workflow.id)}`}
            className="group flex flex-col rounded-lg border border-rule bg-panel p-5 text-ink no-underline transition hover:border-accent/35 hover:bg-panel-hi"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="min-w-0 font-mono text-[15px] leading-snug font-medium tracking-tight text-ink transition-colors group-hover:text-accent-bright">
                {workflow.workflow_name}
              </h2>
              <span className="shrink-0 rounded border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                {workflow.import_count}{" "}
                {workflow.import_count === 1 ? "user" : "users"}
              </span>
            </div>
            <Text
              as="p"
              size="sm"
              className="mt-3 line-clamp-3 flex-1 leading-6 text-muted"
            >
              {workflow.description ||
                "A shared Libretto workflow ready to configure."}
            </Text>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-rule/70 pt-3">
              <Text size="xs" className="text-accent-bright">
                by {workflow.publisher_name}
              </Text>
              {workflow.credential_names.length > 0 && (
                <Text size="xs" className="text-faint">
                  {workflow.credential_names.length}{" "}
                  {workflow.credential_names.length === 1
                    ? "secret"
                    : "secrets"}
                </Text>
              )}
            </div>
          </a>
        ))}
      </section>
    </>,
  );
}

function preferredSourceFile(
  files: Array<{ file_name: string; code: string }>,
): string {
  const preferred =
    files.find((file) => /^index\.[cm]?[tj]sx?$/iu.test(file.file_name)) ??
    files.find((file) => /\.[cm]?[tj]sx?$/iu.test(file.file_name)) ??
    files[0];
  return preferred?.file_name ?? "";
}

function SourceBrowser({
  files,
}: {
  files: Array<{ file_name: string; code: string }>;
}) {
  const [activeFile, setActiveFile] = useState(() => preferredSourceFile(files));
  const active = files.find((file) => file.file_name === activeFile) ?? files[0];

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-panel shadow-[0_0_24px_rgba(18,206,65,0.05)]">
      <div className="flex flex-col lg:grid lg:min-h-[440px] lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav
          aria-label="Source files"
          className="flex gap-1 overflow-x-auto border-b border-rule bg-black/25 p-2 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-r lg:border-b-0 [&::-webkit-scrollbar]:hidden"
        >
          {files.map((file) => {
            const selected = file.file_name === active.file_name;
            return (
              <button
                key={file.file_name}
                type="button"
                onClick={() => setActiveFile(file.file_name)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-left font-mono text-xs transition lg:w-full lg:py-2 ${
                  selected
                    ? "bg-accent/10 text-accent-bright shadow-[inset_0_0_0_1px_rgba(18,206,65,0.18)]"
                    : "text-muted hover:bg-white/4 hover:text-ink"
                }`}
              >
                <span className="truncate">{file.file_name}</span>
              </button>
            );
          })}
        </nav>
        <pre className="max-h-[min(60vh,28rem)] overflow-auto bg-[#0f120f] p-4 lg:max-h-none [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
          <code
            className={CODE_TOKEN_CLASSES}
            dangerouslySetInnerHTML={{
              __html: highlightCode(active.file_name, active.code),
            }}
          />
        </pre>
      </div>
    </div>
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
  const [copiedCli, setCopiedCli] = useState(false);
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

  const secretsNeedingValues = useMemo(() => {
    if (!workflow) return [] as string[];
    return workflow.credential_names.filter((name) => !savedSecrets.has(name));
  }, [savedSecrets, workflow]);

  async function runImport(options: { autoRepair: boolean }) {
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
        auto_repair: options.autoRepair,
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
    if (secretsNeedingValues.length === 0) {
      setAutoRepair(true);
      void runImport({ autoRepair: true });
      return;
    }
    setConfiguring(true);
  }

  const cliPrompt = workflow
    ? buildCliSetupPrompt({
        workflowName: workflow.workflow_name,
        codeUrl: `${cloudApiUrl}/marketplace/${encodeURIComponent(workflow.id)}/code`,
      })
    : "";

  async function importWorkflow(event: FormEvent) {
    event.preventDefault();
    await runImport({ autoRepair });
  }

  if (!workflow) {
    return pageShell(
      <p className={`pt-8 ${error ? "text-red-200" : "text-muted"}`}>
        {error || "Loading workflow…"}
      </p>,
    );
  }

  return pageShell(
    <>
      <a
        href="/marketplace"
        className="inline-flex pt-4 font-mono text-xs text-muted no-underline transition hover:text-ink"
      >
        ← Marketplace
      </a>

      <header className="mt-8">
        <Text
          as="p"
          size="xs"
          className="uppercase tracking-[0.16em] text-accent"
        >
          Shared by {workflow.publisher_name}
        </Text>
        <h1 className="mt-3 font-mono text-3xl leading-[1.15] font-medium tracking-tight text-ink md:text-4xl">
          {workflow.workflow_name}
        </h1>
        <Text as="p" size="md" className="mt-5 max-w-2xl leading-7 text-muted">
          {workflow.description ||
            "A public Libretto workflow you can add to your account."}
        </Text>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
            {workflow.import_count}{" "}
            {workflow.import_count === 1 ? "user" : "users"}
          </span>
          {workflow.credential_names.map((name) => (
            <span
              key={name}
              className="rounded border border-rule px-2 py-1 font-mono text-[10px] text-muted"
            >
              {name}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <aside className="h-fit space-y-2.5 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24 lg:rounded-lg lg:border lg:border-rule lg:bg-panel lg:p-4">
          {build ? (
            <div>
              <Text
                as="p"
                size="xs"
                className="uppercase tracking-[0.14em] text-accent"
              >
                {build.status === "ready"
                  ? "Workflow ready"
                  : build.status === "failed"
                    ? "Build failed"
                    : "Deploying"}
              </Text>
              <Text as="p" size="sm" className="mt-3 leading-6 text-muted">
                {build.status === "deploying"
                  ? "Building a private copy with auto-repair on. It will show up in Workflows when ready."
                  : build.status === "ready"
                    ? "Ready in Libretto Cloud and the Chrome extension."
                    : build.error || "The workflow could not be built."}
              </Text>
              <Button href="/dashboard/workflows" className="mt-4 w-full">
                View workflows
              </Button>
            </div>
          ) : configuring ? (
            <form onSubmit={importWorkflow}>
              <Text
                as="p"
                size="xs"
                className="uppercase tracking-[0.14em] text-accent"
              >
                Connect secrets
              </Text>
              <div className="mt-4 space-y-4">
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
              <label className="mt-4 flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={autoRepair}
                  onChange={(event) => setAutoRepair(event.target.checked)}
                />
                <span className="text-sm text-ink">Auto-repair failed runs</span>
              </label>
              <Button type="submit" disabled={busy} className="mt-4 w-full">
                {busy ? "Deploying…" : "Deploy"}
              </Button>
              <button
                type="button"
                onClick={() => setConfiguring(false)}
                className="mt-2 h-9 w-full text-xs text-muted"
              >
                Cancel
              </button>
            </form>
          ) : busy ? (
            <div>
              <Text
                as="p"
                size="xs"
                className="uppercase tracking-[0.14em] text-accent"
              >
                Deploying
              </Text>
              <Text as="p" size="sm" className="mt-3 leading-6 text-muted">
                Starting a private copy with auto-repair on…
              </Text>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  Libretto Cloud
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  Deploy a private copy for the Chrome extension and API
                  endpoint.
                </p>
                <Button
                  type="button"
                  onClick={startUsingWorkflow}
                  disabled={!workflow.import_available}
                  className="mt-3 w-full"
                >
                  {session ? "Deploy to Cloud" : "Sign in to deploy"}
                </Button>
              </div>
              <div className="border-t border-rule/80 pt-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  Local / CLI
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  Copy a prompt for your coding agent to fetch this source and
                  run it locally.
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center rounded-lg border border-rule bg-transparent font-mono text-xs font-medium tracking-[0.06em] text-muted uppercase transition hover:border-accent/40 hover:bg-white/[0.04] hover:text-accent-bright focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(18,206,65,0.25)]"
                  data-fathom-event="Marketplace copy CLI prompt"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(cliPrompt)
                      .catch(() => {});
                    setCopiedCli(true);
                    window.setTimeout(() => setCopiedCli(false), 1500);
                  }}
                >
                  {copiedCli ? "Copied" : "Copy agent prompt"}
                </button>
              </div>
              {!workflow.import_available && (
                <p className="text-xs leading-5 text-red-200">
                  The publisher must update this shared workflow before it can
                  be imported to Cloud.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="text-xs leading-5 text-red-200">{error}</p>
          )}
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <SourceBrowser files={workflow.files} />
        </div>
      </div>
    </>,
  );
}
