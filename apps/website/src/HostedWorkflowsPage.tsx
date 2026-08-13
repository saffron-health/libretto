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
  source_share_id: string;
  credential_names: string[];
  import_available: boolean;
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
    "Use this published Libretto workflow through its hosted API or adapt its public source code.",
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
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-panel p-3 sm:flex-row sm:items-center">
      <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-accent/15 px-3 font-mono text-xs font-semibold tracking-[0.08em] text-accent-bright">
        {method}
      </span>
      <code className="min-w-0 break-all font-mono text-[12px] leading-5 text-ink sm:text-[13px]">
        {url}
      </code>
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
      className="grid gap-2 border-b border-rule/70 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] sm:gap-4"
      style={{ paddingLeft: `${16 + depth * 16}px` }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <code className="font-mono text-[13px] text-ink">{name}</code>
          <span className="font-mono text-[11px] text-accent/80">{typeLabel}</span>
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.08em] ${
              required ? "text-amber" : "text-faint"
            }`}
          >
            {required ? "required" : "optional"}
          </span>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        {description ? (
          <p className="text-sm leading-6 text-muted">{description}</p>
        ) : (
          <p className="text-sm leading-6 text-faint">No description.</p>
        )}
        {extras.map((extra) => (
          <p key={extra} className="font-mono text-[11px] leading-5 text-faint">
            {extra}
          </p>
        ))}
      </div>
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
    <div className="border-t border-rule/80">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-faint transition hover:bg-white/[0.03] hover:text-muted"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{open ? "Hide raw JSON" : "Show raw JSON"}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre
          aria-label={label}
          className="max-h-[min(50vh,22rem)] overflow-auto border-t border-rule/80 bg-[#0f120f] p-4 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
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
        <SectionHeading title={title}>{description}</SectionHeading>
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
        <div>
          <div className="hidden border-b border-rule/70 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] sm:gap-4">
            <span>Property</span>
            <span>Details</span>
          </div>
          <SchemaTreeRows nodes={nodes} />
        </div>
      )}
      {schema != null && <RawJsonDetails value={schema} label={`${title} JSON`} />}
    </section>
  );
}

function AccessReference({
  requirements,
}: {
  requirements: HostedWorkflowDetail["credential_requirements"];
}) {
  return (
    <section>
      <div className="border-b border-rule pb-4">
        <SectionHeading title="Access">
          Use your own Libretto API key and credentials. They stay in your
          workspace and are never shared with the publisher.
        </SectionHeading>
      </div>
      <div>
        <ParamRow
          name="x-api-key"
          typeLabel="header"
          required
          description="Your Libretto API key."
          extras={[]}
        />
        {requirements.map((req) => (
          <ParamRow
            key={req.name}
            name={`credentials.${req.name}`}
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
          <p className="border-b border-rule/70 px-4 py-4 text-sm text-muted">
            This workflow does not require any additional credentials.
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
          types and reviewed source code are included on every listing.
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
                "A published Libretto workflow you can call or adapt from its source."}
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
    publicCloudGet<HostedWorkflowDetail>(
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
      workflow?.credential_names.filter((name) => !savedSecrets.has(name)) ?? [],
    [savedSecrets, workflow],
  );

  async function deployOwnCopy() {
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

      <div
        role="tablist"
        aria-label="Workflow details"
        className="mt-8 flex border-b border-rule"
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
              className={`relative px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] transition ${
                selected ? "text-accent-bright" : "text-muted hover:text-ink"
              }`}
            >
              {view === "api" ? "Use the API" : "Source code"}
              {selected && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {activeView === "api" ? (
            <>
              <section>
                <SectionHeading title="Run endpoint">
                  Send a POST request to run this workflow in your Libretto
                  workspace.
                </SectionHeading>
                <EndpointBar method="POST" url={runUrl} />
              </section>

              <AccessReference
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
              <SourceBrowser files={workflow.files} />
            </section>
          )}
        </div>

        <aside className="h-fit lg:sticky lg:top-24">
          <div className="rounded-lg border border-rule bg-panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              Coding agent
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              Prompt for a coding agent to call this hosted run endpoint with
              credentials and the input schema.
            </p>
            <Button
              type="button"
              className="mt-4 w-full"
              data-fathom-event="Hosted workflows copy agent prompt"
              onClick={() => {
                void navigator.clipboard.writeText(prompt).catch(() => {});
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy prompt to call this API"}
            </Button>
            {!session && (
              <Button
                href={withReturnTo("/signin", returnTo)}
                variant="secondary"
                className="mt-3 w-full"
              >
                Sign up to generate an API key
              </Button>
            )}

            <div className="mt-5 border-t border-rule/80 pt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                Your own copy
              </p>
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
                    Connect the credentials required by your private copy.
                  </p>
                  <div className="mt-3 space-y-3">
                    {workflow.credential_names.map((name) => {
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
                    {busy ? "Deploying…" : "Fork and deploy"}
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
                  <p className="mt-1.5 text-xs leading-5 text-muted">
                    Fork the source and deploy a private copy to your workspace.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={startDeployingOwnCopy}
                    disabled={!workflow.import_available || busy}
                    className="mt-3 w-full"
                  >
                    {busy
                      ? "Deploying…"
                      : session
                        ? "Fork and deploy your own"
                        : "Sign up to fork and deploy"}
                  </Button>
                  {!workflow.import_available && (
                    <p className="mt-2 text-xs leading-5 text-red-200">
                      The publisher must update this workflow before it can be forked.
                    </p>
                  )}
                </>
              )}
            </div>
            {error && <p className="mt-3 text-xs leading-5 text-red-200">{error}</p>}
          </div>
        </aside>
      </div>
    </>,
  );
}
