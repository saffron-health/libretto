import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "./components/Button";
import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import { Text } from "./components/Text";
import {
  authGet,
  getAuthStatus,
  getCloudSession,
  orpcCall,
  publicCloudGet,
  cloudApiUrl,
  type CloudSession,
} from "./cloudApi";
import { withReturnTo } from "./authRedirect";
import { Prism } from "./prism";
import { SourceBrowser } from "./SourceBrowser";

export type HostedWorkflowSummary = {
  tenant_slug: string;
  workflow_name: string;
  description: string | null;
  publisher_name: string;
  credential_requirements: Array<{ name: string; description: string }>;
  deployment_version: number;
  published_at: string;
  page_url: string;
};

type HostedWorkflowDetail = HostedWorkflowSummary & {
  input_schema: unknown;
  output_schema: unknown;
  source_access: "granted" | "sign_in_required";
  source_share_id?: string;
  credential_names?: string[];
  import_available?: boolean;
  files?: Array<{ file_name: string; code: string }>;
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

type SchemaNode = {
  name: string;
  typeLabel: string;
  required: boolean;
  description: string | null;
  extras: string[];
  children: SchemaNode[];
};

const CODE_TOKEN_CLASSES =
  "font-mono text-[13px] leading-6 text-ink [&_.token.boolean]:text-[#79c0ff] [&_.token.builtin]:text-[#ffa657] [&_.token.class-name]:text-[#ffa657] [&_.token.comment]:text-[#8b949e] [&_.token.function]:text-[#d2a8ff] [&_.token.keyword]:text-[#ff7b72] [&_.token.number]:text-[#79c0ff] [&_.token.operator]:text-[#ff7b72] [&_.token.property]:text-[#79c0ff] [&_.token.punctuation]:text-[#c9d1d9] [&_.token.string]:text-[#a5d6ff] [&_.token.variable]:text-[#ffa657]";

function pageShell(children: ReactNode) {
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

function hostedKey(workflow: Pick<HostedWorkflowSummary, "tenant_slug" | "workflow_name">) {
  return `${workflow.tenant_slug}/${workflow.workflow_name}`;
}

function hostedPath(workflow: Pick<HostedWorkflowSummary, "tenant_slug" | "workflow_name">) {
  return `/hosted-workflows/${encodeURIComponent(workflow.tenant_slug)}/${encodeURIComponent(workflow.workflow_name)}`;
}

function matchesQuery(workflow: HostedWorkflowSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    workflow.workflow_name,
    workflow.description ?? "",
    workflow.publisher_name,
    workflow.tenant_slug,
  ]
    .join(" ")
    .toLowerCase();
  return needle
    .split(/\s+/u)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function formatSchemaType(schema: unknown): string {
  if (!isRecord(schema)) {
    if (schema == null) return "unknown";
    return typeof schema;
  }

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    const name = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
    return name || "ref";
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return "enum";
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((item) => formatSchemaType(item)).join(" | ");
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((item) => formatSchemaType(item)).join(" | ");
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((item) => formatSchemaType(item)).join(" & ");
  }

  const typeValue = schema.type;
  if (Array.isArray(typeValue)) {
    return typeValue.map(String).join(" | ");
  }
  if (typeof typeValue === "string") {
    if (typeValue === "array") {
      const items = schema.items;
      if (items == null) return "array";
      return `array of ${formatSchemaType(items)}`;
    }
    if (typeValue === "object" && isRecord(schema.additionalProperties)) {
      return `map of ${formatSchemaType(schema.additionalProperties)}`;
    }
    return typeValue;
  }

  if (isRecord(schema.properties)) return "object";
  if (schema.items != null) return `array of ${formatSchemaType(schema.items)}`;
  return "object";
}

function schemaExtras(schema: unknown): string[] {
  if (!isRecord(schema)) return [];
  const extras: string[] = [];

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    extras.push(
      `Allowed values: ${schema.enum
        .map((value) => JSON.stringify(value))
        .join(", ")}`,
    );
  }
  if (schema.default !== undefined) {
    extras.push(`Default: ${JSON.stringify(schema.default)}`);
  }
  if (typeof schema.format === "string") {
    extras.push(`Format: ${schema.format}`);
  }
  if (typeof schema.pattern === "string") {
    extras.push(`Pattern: ${schema.pattern}`);
  }
  if (typeof schema.minimum === "number") {
    extras.push(`Minimum: ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number") {
    extras.push(`Maximum: ${schema.maximum}`);
  }
  if (typeof schema.minLength === "number") {
    extras.push(`Min length: ${schema.minLength}`);
  }
  if (typeof schema.maxLength === "number") {
    extras.push(`Max length: ${schema.maxLength}`);
  }
  if (schema.nullable === true) {
    extras.push("Nullable");
  }

  return extras;
}

function childSchemas(schema: unknown): SchemaNode[] {
  if (!isRecord(schema)) return [];

  if (isRecord(schema.properties)) {
    const required = new Set(asStringArray(schema.required));
    return Object.entries(schema.properties).map(([name, child]) =>
      buildSchemaNode(name, child, required.has(name)),
    );
  }

  if (schema.type === "array" && isRecord(schema.items)) {
    const items = schema.items;
    if (isRecord(items.properties)) {
      return childSchemas(items);
    }
  }

  return [];
}

function buildSchemaNode(
  name: string,
  schema: unknown,
  required: boolean,
): SchemaNode {
  return {
    name,
    typeLabel: formatSchemaType(schema),
    required,
    description:
      isRecord(schema) && typeof schema.description === "string"
        ? schema.description
        : null,
    extras: schemaExtras(schema),
    children: childSchemas(schema),
  };
}

function schemaRootNodes(schema: unknown): SchemaNode[] {
  if (schema == null) return [];
  if (!isRecord(schema)) {
    return [
      {
        name: "(root)",
        typeLabel: formatSchemaType(schema),
        required: true,
        description: null,
        extras: [],
        children: [],
      },
    ];
  }

  if (isRecord(schema.properties) || schema.type === "object") {
    return childSchemas(schema);
  }

  return [
    {
      name: "(root)",
      typeLabel: formatSchemaType(schema),
      required: true,
      description:
        typeof schema.description === "string" ? schema.description : null,
      extras: schemaExtras(schema),
      children: childSchemas(schema),
    },
  ];
}

function highlightJson(value: unknown): string {
  const code = value == null ? "null" : JSON.stringify(value, null, 2);
  if (Prism.languages.json) {
    return Prism.highlight(code, Prism.languages.json, "json");
  }
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildHostedAgentPrompt(workflow: HostedWorkflowDetail): string {
  const runUrl = `${cloudApiUrl}/v1/hosted-workflows/run/${encodeURIComponent(workflow.tenant_slug)}/${encodeURIComponent(workflow.workflow_name)}`;
  const credLines =
    workflow.credential_requirements.length === 0
      ? ["- (none)"]
      : workflow.credential_requirements.map(
          (req) => `- \`${req.name}\`: ${req.description}`,
        );
  const schemaBlock =
    workflow.input_schema == null
      ? "Input schema is not available for this workflow."
      : [
          "Input JSON schema:",
          "```json",
          JSON.stringify(workflow.input_schema, null, 2),
          "```",
        ].join("\n");

  return [
    "Use this published Libretto workflow through its hosted API. Sign in to Libretto to review or adapt its source code.",
    "",
    `Hosted workflow: ${hostedKey(workflow)}`,
    workflow.description?.trim()
      ? `Description: ${workflow.description.trim()}`
      : null,
    `Docs page: ${typeof window !== "undefined" ? window.location.href : workflow.page_url}`,
    `Run endpoint: POST ${runUrl}`,
    "",
    "Authenticate with your Libretto API key in the `x-api-key` header.",
    "Pass a `credentials` map in the run body: each key is a required name below, and each value is either a credential id or a secret name from YOUR tenant:",
    ...credLines,
    "",
    schemaBlock,
    "",
    "Or poll instead of a callback by setting `\"skip_callbacks\": true` and calling `POST /v1/jobs/get` with the returned `job_id`.",
    "Jobs and credentials stay in your tenant. The publisher cannot see your identity, inputs, credentials, outputs, errors, or job details.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {eyebrow && (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {eyebrow}
        </p>
      )}
      <h2 className="text-lg font-medium tracking-tight text-ink">{title}</h2>
      {children && (
        <Text as="p" size="sm" className="mt-2 max-w-2xl leading-6 text-muted">
          {children}
        </Text>
      )}
    </div>
  );
}

function EndpointBar({ method, url }: { method: string; url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-rule bg-panel shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
      <span className="inline-flex shrink-0 items-center border-r border-rule bg-accent/[0.08] px-3 font-mono text-[10px] font-semibold tracking-[0.1em] text-accent-bright">
        {method}
      </span>
      <div className="min-w-0 flex-1 px-3 py-3">
        <code className="break-all font-mono text-[11px] leading-5 text-ink">
          {url}
        </code>
      </div>
      <button
        type="button"
        className="shrink-0 border-l border-rule px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted transition hover:bg-panel-hi hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ParamRow({
  name,
  typeLabel,
  required,
  description,
  extras,
  depth = 0,
}: {
  name: string;
  typeLabel: string;
  required: boolean;
  description: string | null;
  extras: string[];
  depth?: number;
}) {
  return (
    <div
      className="border-b border-rule/70 py-4 last:border-b-0"
      style={{ paddingLeft: `${depth * 20}px` }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <code className="font-mono text-[14px] font-medium text-ink">{name}</code>
        <span className="font-mono text-[12px] text-accent/80">{typeLabel}</span>
        <span
          className={`text-xs ${required ? "text-muted" : "text-faint"}`}
        >
          {required ? "Required" : "Optional"}
        </span>
      </div>
      {description && (
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
      )}
      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {extras.map((extra) => (
            <span
              key={extra}
              className="rounded border border-rule/80 px-1.5 py-0.5 font-mono text-[10px] text-faint"
            >
              {extra}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaTreeRows({
  nodes,
  depth = 0,
}: {
  nodes: SchemaNode[];
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.name}`}>
          <ParamRow
            name={node.name}
            typeLabel={node.typeLabel}
            required={node.required}
            description={node.description}
            extras={node.extras}
            depth={depth}
          />
          {node.children.length > 0 && (
            <SchemaTreeRows nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  );
}

function RawJsonDetails({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="pt-3">
      <button
        type="button"
        className="inline-flex items-center gap-3 rounded-md border border-rule bg-panel px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-muted transition hover:border-accent/40 hover:bg-panel-hi hover:text-ink"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{open ? "Hide raw JSON" : "Show raw JSON"}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre
          aria-label={label}
          className="mt-3 max-h-[min(50vh,22rem)] overflow-auto rounded-md border border-rule/80 bg-[#0f120f] p-4 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
        >
          <code
            className={CODE_TOKEN_CLASSES}
            dangerouslySetInnerHTML={{ __html: highlightJson(value) }}
          />
        </pre>
      )}
    </div>
  );
}

function SchemaReference({
  title,
  description,
  schema,
  emptyLabel,
}: {
  title: string;
  description: string;
  schema: unknown;
  emptyLabel: string;
}) {
  const nodes = useMemo(() => schemaRootNodes(schema), [schema]);

  return (
    <section>
      <div className="border-b border-rule pb-4">
        <h2 className="text-2xl font-medium tracking-tight text-ink">{title}</h2>
        <Text as="p" size="sm" className="mt-2 leading-6 text-muted">
          {description}
        </Text>
      </div>
      {schema == null ? (
        <p className="py-5 text-sm text-muted">{emptyLabel}</p>
      ) : nodes.length === 0 ? (
        <div className="py-2">
          <ParamRow
            name="(schema)"
            typeLabel={formatSchemaType(schema)}
            required={false}
            description="No object properties were declared on this schema."
            extras={schemaExtras(schema)}
          />
        </div>
      ) : (
        <SchemaTreeRows nodes={nodes} />
      )}
      {schema != null && <RawJsonDetails value={schema} label={`${title} JSON`} />}
    </section>
  );
}

function CredentialsReference({
  requirements,
}: {
  requirements: HostedWorkflowDetail["credential_requirements"];
}) {
  return (
    <section>
      <div className="border-b border-rule pb-4">
        <h2 className="text-2xl font-medium tracking-tight text-ink">
          Credentials
        </h2>
        <Text as="p" size="sm" className="mt-2 leading-6 text-muted">
          Pass these values under <code className="text-ink">credentials</code>{" "}
          in the request body.
        </Text>
      </div>
      <div>
        {requirements.map((req) => (
          <ParamRow
            key={req.name}
            name={req.name}
            typeLabel="string"
            required
            description={
              req.description ||
              "A secret name or credential id from your workspace."
            }
            extras={[]}
          />
        ))}
        {requirements.length === 0 && (
          <p className="border-b border-rule/70 py-4 text-sm text-muted">
            No credentials required.
          </p>
        )}
      </div>
    </section>
  );
}

export function HostedWorkflowsPage() {
  const [workflows, setWorkflows] = useState<HostedWorkflowSummary[] | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicCloudGet<{ workflows: HostedWorkflowSummary[] }>("/hosted-workflows")
      .then((result) => setWorkflows(result.workflows))
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load hosted workflows.",
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
          as="h1"
          size="5xl"
          style="serif"
          wrap="balance"
          className="font-[300] leading-[1.05] tracking-[-0.035em] text-ink"
        >
          Published workflows
        </Text>
        <Text as="p" size="md" className="mt-5 max-w-xl leading-7 text-muted">
          Public run endpoints you call with your own API key. Input and output
          types are public; sign in to review source code and clone a workflow.
        </Text>
      </header>

      <div className="mb-8 max-w-xl">
        <label className="relative block">
          <span className="sr-only">Search published workflows</span>
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
            placeholder="Search workflows or publishers…"
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
        <p className="text-sm text-muted">Loading hosted workflows…</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-400/30 bg-red-950/20 p-4 text-red-200">
          {error}
        </p>
      )}
      {workflows?.length === 0 && (
        <p className="rounded-lg border border-rule bg-panel p-8 text-muted">
          No workflows yet.
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
            key={hostedKey(workflow)}
            href={hostedPath(workflow)}
            className="group rounded-lg border border-rule bg-panel p-5 no-underline transition hover:border-accent/35 hover:bg-panel-hi hover:shadow-[0_0_24px_rgba(18,206,65,0.06)]"
          >
            <Text
              as="p"
              size="xs"
              className="uppercase tracking-[0.14em] text-accent"
            >
              {workflow.publisher_name}
            </Text>
            <h2 className="mt-3 font-mono text-lg font-medium tracking-tight text-ink group-hover:text-accent-bright">
              {workflow.workflow_name}
            </h2>
            <Text as="p" size="sm" className="mt-3 line-clamp-3 leading-6 text-muted">
              {workflow.description?.trim() ||
                "A published Libretto workflow you can call now or clone after signing in."}
            </Text>
          </a>
        ))}
      </section>
    </>,
  );
}

export function HostedWorkflowPage({
  tenantSlug,
  workflowName,
}: {
  tenantSlug: string;
  workflowName: string;
}) {
  const [workflow, setWorkflow] = useState<HostedWorkflowDetail | null>(null);
  const [session, setSession] = useState<CloudSession | null>(null);
  const [hasTenant, setHasTenant] = useState(false);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoRepair, setAutoRepair] = useState(true);
  const [build, setBuild] = useState<WorkflowBuildStatus | null>(null);
  const [activeView, setActiveView] = useState<"api" | "source">("api");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authGet<HostedWorkflowDetail>(
      `/hosted-workflows/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(workflowName)}/data`,
    )
      .then(setWorkflow)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load this hosted workflow.",
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
  }, [tenantSlug, workflowName]);

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
  const secretsNeedingValues = useMemo(
    () =>
      workflow?.credential_names?.filter((name) => !savedSecrets.has(name)) ?? [],
    [savedSecrets, workflow],
  );

  async function deployOwnCopy() {
    if (!workflow?.source_share_id) return;
    setBusy(true);
    setError(null);
    try {
      const credentialIds: string[] = [];
      for (const name of workflow.credential_names ?? []) {
        const saved = savedSecrets.get(name);
        if (saved) {
          credentialIds.push(saved.credential_id);
          continue;
        }
        const value = values[name];
        if (!value?.trim()) throw new Error(`Enter a value for ${name}.`);
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
      }>("/v1/openWorkflows/import", {
        share_id: workflow.source_share_id,
        credential_ids: credentialIds,
        auto_repair: autoRepair,
      });
      setBuild({ ...result, error: null });
      setConfiguring(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not deploy this workflow.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startDeployingOwnCopy() {
    if (!workflow) return;
    const returnTo = hostedPath(workflow);
    if (!session) {
      window.location.assign(withReturnTo("/signin", returnTo));
      return;
    }
    if (!hasTenant) {
      window.location.assign(withReturnTo("/onboarding", returnTo));
      return;
    }
    if (secretsNeedingValues.length === 0) {
      void deployOwnCopy();
      return;
    }
    setConfiguring(true);
  }

  function submitOwnCopy(event: FormEvent) {
    event.preventDefault();
    void deployOwnCopy();
  }

  if (!workflow) {
    return pageShell(
      <p className={`pt-8 ${error ? "text-red-200" : "text-muted"}`}>
        {error || "Loading hosted workflow…"}
      </p>,
    );
  }

  const prompt = buildHostedAgentPrompt(workflow);
  const runUrl = `${cloudApiUrl}/v1/hosted-workflows/run/${encodeURIComponent(workflow.tenant_slug)}/${encodeURIComponent(workflow.workflow_name)}`;
  const returnTo = hostedPath(workflow);
  const canViewSource = workflow.source_access === "granted";
  const showSource = canViewSource && activeView === "source";

  return pageShell(
    <>
      <a
        href="/hosted-workflows"
        className="inline-flex pt-4 font-mono text-xs text-muted no-underline transition hover:text-ink"
      >
        ← Published workflows
      </a>

      <header className="mt-8 max-w-3xl">
        <Text
          as="p"
          size="xs"
          className="uppercase tracking-[0.16em] text-accent"
        >
          Hosted by {workflow.publisher_name}
        </Text>
        <h1 className="mt-3 font-mono text-3xl leading-[1.15] font-medium tracking-tight text-ink md:text-4xl">
          {workflow.workflow_name}
        </h1>
        <Text as="p" size="md" className="mt-5 max-w-2xl leading-7 text-muted">
          {workflow.description?.trim() ||
            "A public Libretto hosted workflow you can call with your API key."}
        </Text>
      </header>

      {canViewSource && (
        <div
          role="tablist"
          aria-label="Workflow details"
          className="mt-8 grid max-w-md grid-cols-2 gap-1 rounded-lg border border-rule bg-panel p-1"
        >
          {(["api", "source"] as const).map((view) => {
            const selected = activeView === view;
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveView(view)}
                className={`rounded-md border px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] transition ${
                  selected
                    ? "border-accent/35 bg-accent/[0.12] text-accent-bright shadow-[inset_0_0_18px_rgba(18,206,65,0.06)]"
                    : "border-transparent text-muted hover:bg-panel-hi hover:text-ink"
                }`}
              >
                {view === "api" ? "API spec" : "Source code"}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {!showSource ? (
            <>
              <EndpointBar method="POST" url={runUrl} />

              <section>
                <div className="border-b border-rule pb-4">
                  <h2 className="text-2xl font-medium tracking-tight text-ink">
                    Authentication
                  </h2>
                </div>
                <ParamRow
                  name="x-api-key"
                  typeLabel="header"
                  required
                  description="Send your Libretto API key with every request."
                  extras={[]}
                />
              </section>

              <CredentialsReference
                requirements={workflow.credential_requirements}
              />

              <SchemaReference
                title="Request fields"
                description="Pass these fields under params in the JSON request body."
                schema={workflow.input_schema}
                emptyLabel="This workflow has no declared request fields."
              />

              <SchemaReference
                title="Response fields"
                description="The workflow returns these fields when the job completes."
                schema={workflow.output_schema}
                emptyLabel="This workflow has no declared response fields."
              />
            </>
          ) : (
            <section>
              <SectionHeading title="Workflow code">
                Review or adapt the source included with this shared workflow.
              </SectionHeading>
              <SourceBrowser files={workflow.files ?? []} />
            </section>
          )}
        </div>

        <aside className="h-fit lg:sticky lg:top-24">
          <div className="rounded-lg border border-rule bg-panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              Use this workflow
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              {canViewSource
                ? "Call the API directly or deploy your own copy."
                : "Call the API now. Sign up to view the source and clone it."}
            </p>
            <Button
              type="button"
              variant={canViewSource ? undefined : "outline"}
              className="mt-4 w-full !min-w-0"
              data-fathom-event="Hosted workflows copy agent prompt"
              onClick={() => {
                void navigator.clipboard.writeText(prompt).catch(() => {});
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy API prompt"}
            </Button>
            {!canViewSource && (
              <Button
                href={withReturnTo("/signin?mode=signup", returnTo)}
                className="mt-3 w-full !min-w-0"
              >
                Sign up to view source
              </Button>
            )}

            {canViewSource && (
              <div className="mt-3">
                {build ? (
                <>
                  <p className="mt-1.5 text-xs leading-5 text-muted">
                    {build.status === "deploying"
                      ? "Forking the source and deploying a private copy…"
                      : build.status === "ready"
                        ? "Your private copy is ready in Libretto Cloud."
                        : build.error || "The private copy could not be deployed."}
                  </p>
                  {build.status === "ready" && (
                    <Button href="/dashboard/workflows" className="mt-3 w-full">
                      View your workflows
                    </Button>
                  )}
                </>
              ) : configuring ? (
                <form onSubmit={submitOwnCopy}>
                  <p className="mt-1.5 text-xs leading-5 text-muted">
                    Add the credentials needed by your copy.
                  </p>
                  <div className="mt-3 space-y-3">
                    {(workflow.credential_names ?? []).map((name) => {
                      const saved = savedSecrets.has(name);
                      return (
                        <label key={name} className="block">
                          <span className="mb-1.5 block font-mono text-xs text-muted">
                            {name}
                          </span>
                          {saved ? (
                            <span className="block rounded-md border border-accent/30 bg-green-3/20 px-3 py-2 text-xs text-accent-bright">
                              Using saved credential
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
                              className="h-9 w-full rounded-md border border-rule bg-bg px-3 text-xs outline-none focus:border-accent"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={autoRepair}
                      onChange={(event) => setAutoRepair(event.target.checked)}
                    />
                    <span className="text-xs text-ink">Auto-repair failed runs</span>
                  </label>
                  <Button type="submit" disabled={busy} className="mt-3 w-full">
                    {busy ? "Deploying…" : "Deploy copy"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setConfiguring(false)}
                    className="mt-2 h-8 w-full text-xs text-muted"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={startDeployingOwnCopy}
                    disabled={!workflow.import_available || busy}
                    className="w-full"
                  >
                    {busy
                      ? "Deploying…"
                      : session
                        ? "Fork and deploy your own copy"
                        : "Sign up to fork a copy"}
                  </Button>
                  {!workflow.import_available && (
                    <p className="mt-2 text-xs leading-5 text-red-200">
                      The publisher must update this workflow before it can be forked.
                    </p>
                  )}
                </>
                )}
              </div>
            )}
            {error && <p className="mt-3 text-xs leading-5 text-red-200">{error}</p>}
          </div>
        </aside>
      </div>
    </>,
  );
}
