import { useState } from "react";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Text } from "./components/Text";
import { Kicker } from "./components/Kicker";
import { SectionDivider } from "./components/SectionDivider";
import { ShellCommand } from "./components/ShellCommand";
import { CanvasAsciihedron } from "./components/CanvasAsciihedron";

const INSTALL_COMMAND = "npm i libretto-browser-tools";

function CodeWindow() {
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-[#0b0e0b] shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-rule bg-panel/80 px-4 py-3">
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-faint">
          AGENT.TS
        </span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.85] sm:p-7 sm:text-[13px]">
        <code>
          <span className="text-faint">
            {"// Supports Kernel, Browserbase, and more"}
          </span>
          {"\n"}
          <span className="text-faint">const</span>
          <span className="text-ink"> provider = </span>
          <span className="text-faint">new</span>
          <span className="text-accent-bright"> LocalBrowserProvider</span>
          <span className="text-ink">();</span>
          {"\n\n"}
          <span className="text-faint">
            {"// Adapters for AI SDK, Pi, and MCP"}
          </span>
          {"\n"}
          <span className="text-faint">const</span>
          <span className="text-ink"> {"{ tools }"} = </span>
          <span className="text-accent-bright">createAiSdkBrowserTools</span>
          <span className="text-ink">(provider);</span>
          {"\n\n"}
          <span className="text-faint">const</span>
          <span className="text-ink"> result = </span>
          <span className="text-faint">await</span>
          <span className="text-accent-bright"> generateText</span>
          <span className="text-ink">({"{\n  model,\n  tools,\n  prompt: "}</span>
          <span className="text-amber">
            &quot;Find the top story on Hacker News&quot;
          </span>
          <span className="text-ink">{",\n});"}</span>
        </code>
      </pre>
    </div>
  );
}

function BrowserToolsHero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 md:px-8 md:pt-24 md:pb-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_64%_28%,color-mix(in_oklch,var(--color-green-9)_11%,transparent),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 flex translate-y-6 items-center justify-center select-none max-md:translate-y-0 lg:justify-end lg:pr-[4%]">
        <CanvasAsciihedron
          className="h-[1200px] w-[1200px] min-h-[900px] min-w-[900px] max-h-[160vw] max-w-[160vw] shrink-0 text-ink lg:h-[1400px] lg:w-[1400px]"
          showAnnotations={false}
          objectScale={1.15}
          baseOpacity={0.1}
        />
      </div>
      <div className="relative mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20">
        <div>
          <Kicker className="mb-5">// BROWSER TOOLS SDK --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            wrap="pretty"
            className="crt-glow mb-6 max-w-[620px] tracking-[-0.045em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(42px, 6vw, 72px)",
              lineHeight: 0.98,
            }}
          >
            Give your agent a browser.
          </Text>
          <Text
            as="p"
            size="lg"
            wrap="pretty"
            className="mb-9 max-w-[560px] leading-relaxed text-muted"
          >
            Six tools let any AI agent open a real browser, read the page, and
            act with Playwright.
          </Text>
          <ShellCommand
            ariaLabel="Copy browser tools install command"
            command={INSTALL_COMMAND}
            fathomEvent="Browser tools hero install copy"
            className="max-w-[390px]"
          />
        </div>
        <CodeWindow />
      </div>
    </section>
  );
}

function ToolCallExample({
  call,
  result,
}: {
  call: React.ReactNode;
  result: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto p-5 font-mono text-[11px] leading-6">
      <div className="text-accent-bright">{call}</div>
      <div className="mt-3 border-t border-rule/80 pt-3 text-muted">{result}</div>
    </div>
  );
}

function ToolCard({
  index,
  name,
  example,
  children,
}: {
  index: string;
  name: string;
  example: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-rule bg-panel/70 p-6 md:p-8">
      <div className="absolute top-0 right-0 border-b border-l border-rule px-3 py-2 font-mono text-[10px] text-faint">
        {index}
      </div>
      <Text as="h3" size="xl" wrap="pretty" className="mb-3 text-accent-bright">
        {name}
      </Text>
      <Text
        as="p"
        size="sm"
        wrap="pretty"
        className="max-w-[390px] leading-relaxed text-muted"
      >
        {children}
      </Text>
      <div className="mt-6 overflow-hidden rounded-lg border border-rule bg-[#0b0e0b]">
        {example}
      </div>
    </div>
  );
}

function ToolsSection() {
  return (
    <section className="section-crt px-6 py-24 md:px-12 md:py-32">
      <div className="relative mx-auto max-w-[920px]">
        <div className="mx-auto mb-14 max-w-[620px] text-center">
          <Kicker className="mb-4">// HOW IT WORKS --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="pretty"
            className="mb-5 tracking-[-0.035em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            Two tools do most of the work.
          </Text>
          <Text as="p" wrap="pretty" className="leading-relaxed text-muted">
            The agent reads a short page snapshot, then runs the Playwright code
            it needs.
          </Text>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ToolCard
            index="01"
            name="browser_snapshot"
            example={
              <ToolCallExample
                call={
                  <>
                    <span className="text-ink">browser_snapshot</span>
                    <span className="text-faint"> ses-4f2a</span>
                  </>
                }
                result={
                  <>
                    <span className="text-faint">&lt;page title=&quot;Hacker News&quot;&gt;</span>
                    {"\n  "}
                    <span className="text-ink">heading</span> &quot;Hacker News&quot;
                    {"\n  "}
                    <span className="text-accent-bright">link</span> &quot;Show HN:
                    Browser Tools&quot; <span className="text-amber">[ref=l12]</span>
                    {"\n  "}
                    <span className="text-accent-bright">link</span> &quot;42
                    comments&quot; <span className="text-amber">[ref=l13]</span>
                  </>
                }
              />
            }
          >
            Returns a compact accessibility tree with stable refs. The agent
            can read the page structure without raw HTML.
          </ToolCard>
          <ToolCard
            index="02"
            name="browser_exec"
            example={
              <ToolCallExample
                call={
                  <>
                    <span className="text-ink">browser_exec</span>{" "}
                    <span className="text-amber">
                      &quot;await page.locator(&apos;.titleline &gt; a&apos;).first().click()&quot;
                    </span>
                  </>
                }
                result={
                  <>
                    <span className="text-faint">{"{"}</span>
                    {"\n  "}
                    <span className="text-ink">ok</span>
                    <span className="text-faint">: </span>
                    <span className="text-accent-bright">true</span>
                    <span className="text-faint">,</span>
                    {"\n  "}
                    <span className="text-ink">snapshotDiff</span>
                    <span className="text-faint">: </span>
                    <span className="text-amber">&quot;+ article [ref=l20]&quot;</span>
                    {"\n"}
                    <span className="text-faint">{"}"}</span>
                  </>
                }
              />
            }
          >
            Runs Playwright code on the live page. Each call returns a compact
            snapshot diff that shows what changed.
          </ToolCard>
        </div>

        <div className="mx-auto grid max-w-[640px] grid-cols-[1fr_auto_1fr] items-center py-7 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <div className="h-px bg-[repeating-linear-gradient(90deg,var(--color-rule)_0,var(--color-rule)_5px,transparent_5px,transparent_10px)]" />
          <span className="mx-4 text-accent-bright">inspect → decide → act</span>
          <div className="h-px bg-[repeating-linear-gradient(90deg,var(--color-rule)_0,var(--color-rule)_5px,transparent_5px,transparent_10px)]" />
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3">
          {[
            ["browser_open", "Start a local browser session"],
            ["browser_status", "List pages and session state"],
            ["browser_close", "Clean up when the job is done"],
          ].map(([name, description]) => (
            <div key={name} className="bg-bg/95 p-5">
              <div className="mb-2 font-mono text-xs text-ink">{name}</div>
              <div className="text-xs leading-relaxed text-muted">{description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const BENCHMARK_RESULTS_URL =
  "https://github.com/saffron-health/libretto/blob/main/packages/browser-tools/benchmarks/RESULTS.md";

type BrowserToolsBenchmarkMetricId = "outcome" | "cost" | "tokens";

type BrowserToolsBenchmarkRow = {
  id: string;
  label: string;
  highlight: boolean;
  outcome: number;
  outcomeDisplay: string;
  cost: number;
  costDisplay: string;
  tokens: number;
  tokensDisplay: string;
};

const BROWSER_TOOLS_BENCHMARK_ROWS: BrowserToolsBenchmarkRow[] = [
  {
    id: "browser-tools",
    label: "Browser Tools",
    highlight: true,
    outcome: 24,
    outcomeDisplay: "24/26",
    cost: 0.106,
    costDisplay: "$0.106",
    tokens: 1.45,
    tokensDisplay: "1.45M",
  },
  {
    id: "dev-browser",
    label: "dev-browser",
    highlight: false,
    outcome: 24,
    outcomeDisplay: "24/26",
    cost: 0.257,
    costDisplay: "$0.257",
    tokens: 3.51,
    tokensDisplay: "3.51M",
  },
  {
    id: "agent-browser",
    label: "agent-browser",
    highlight: false,
    outcome: 23,
    outcomeDisplay: "23/26",
    cost: 0.235,
    costDisplay: "$0.235",
    tokens: 2.29,
    tokensDisplay: "2.29M",
  },
  {
    id: "playwright-cli",
    label: "playwright-cli",
    highlight: false,
    outcome: 22,
    outcomeDisplay: "22/26",
    cost: 0.293,
    costDisplay: "$0.293",
    tokens: 3.48,
    tokensDisplay: "3.48M",
  },
];

const BROWSER_TOOLS_BENCHMARK_METRICS: {
  id: BrowserToolsBenchmarkMetricId;
  label: string;
  icon: "outcome" | "dollar" | "tokens";
}[] = [
  { id: "outcome", label: "Outcome", icon: "outcome" },
  { id: "cost", label: "Cost", icon: "dollar" },
  { id: "tokens", label: "Token usage", icon: "tokens" },
];

function BrowserToolsBenchmarkMetricIcon({
  icon,
}: {
  icon: "outcome" | "dollar" | "tokens";
}) {
  if (icon === "outcome") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
        <circle
          cx="8"
          cy="8"
          r="5.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M5.5 8.1 7.2 9.8 10.6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (icon === "dollar") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
        <path
          d="M8 2.75v10.5M10.75 5.25C10.2 4.45 9.22 4 8.05 4 6.55 4 5.5 4.7 5.5 5.75c0 2.4 5.25 1.1 5.25 3.75 0 1.05-1.08 1.75-2.62 1.75-1.28 0-2.35-.48-2.88-1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <path
        d="M3.5 4.25h9M3.5 8h9M3.5 11.75h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.5 2.75 4.25 13.25M11.75 2.75 10.5 13.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BrowserToolsBenchmarkBar({
  label,
  value,
  display,
  max,
  highlight,
}: {
  label: string;
  value: number;
  display: string;
  max: number;
  highlight: boolean;
}) {
  const width = value === 0 ? "0%" : `${Math.max(8, (value / max) * 100)}%`;
  const barClass = highlight
    ? "bg-accent shadow-[0_0_18px_color-mix(in_oklch,var(--color-green-9)_35%,transparent)]"
    : "bg-ink/24";
  const rowClass = highlight
    ? "rounded-sm border border-accent/25 bg-accent/10 p-3"
    : "rounded-sm border border-transparent p-3";

  return (
    <div className={rowClass}>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <Text
          size="xs"
          className={highlight ? "text-accent" : "text-muted"}
        >
          {label}
        </Text>
        <span
          className={
            highlight
              ? "font-mono text-sm text-accent"
              : "font-mono text-sm text-ink/60"
          }
        >
          {display}
        </span>
      </div>
      <div className="h-5 overflow-hidden rounded-sm bg-black/40 ring-1 ring-ink/10">
        <div
          className={`h-full rounded-sm transition-[width] duration-500 ease-out ${barClass}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

function BenchmarksSection() {
  const [activeMetricId, setActiveMetricId] =
    useState<BrowserToolsBenchmarkMetricId>("cost");
  const activeMetric =
    BROWSER_TOOLS_BENCHMARK_METRICS.find(
      (metric) => metric.id === activeMetricId,
    ) ?? BROWSER_TOOLS_BENCHMARK_METRICS[1];

  const values = BROWSER_TOOLS_BENCHMARK_ROWS.map((row) => {
    if (activeMetricId === "outcome") {
      return {
        id: row.id,
        label: row.label,
        highlight: row.highlight,
        value: row.outcome,
        display: row.outcomeDisplay,
      };
    }
    if (activeMetricId === "cost") {
      return {
        id: row.id,
        label: row.label,
        highlight: row.highlight,
        value: row.cost,
        display: row.costDisplay,
      };
    }
    return {
      id: row.id,
      label: row.label,
      highlight: row.highlight,
      value: row.tokens,
      display: row.tokensDisplay,
    };
  });
  const maxValue =
    activeMetricId === "outcome"
      ? 26
      : Math.max(...values.map((row) => row.value), 1);

  return (
    <section className="px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-10 max-w-[640px]">
          <Kicker className="mb-4">// BENCHMARKS --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="pretty"
            className="mb-5 tracking-[-0.035em] text-ink"
            htmlStyle={{ fontWeight: 300 }}
          >
            55% lower cost than alternatives
          </Text>
          <Text as="p" wrap="pretty" className="leading-relaxed text-muted">
            Lets your agent work through complex pages with less overhead — and
            a lot less cost.
          </Text>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 rounded-sm border border-ink/10 bg-black/20 p-1.5">
          {BROWSER_TOOLS_BENCHMARK_METRICS.map((metric) => {
            const isActive = metric.id === activeMetric.id;
            return (
              <button
                key={metric.id}
                type="button"
                aria-pressed={isActive}
                data-fathom-event={`Browser tools benchmarks ${metric.label} tab click`}
                onClick={() => setActiveMetricId(metric.id)}
                className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-sm px-2 text-[11px] uppercase tracking-[0.08em] transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 sm:px-3 sm:text-xs ${
                  isActive
                    ? "bg-accent text-black"
                    : "text-muted hover:bg-ink/5 hover:text-ink"
                }`}
              >
                <BrowserToolsBenchmarkMetricIcon icon={metric.icon} />
                <span>{metric.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative min-h-[320px] overflow-hidden border border-ink/10 bg-black/30 p-5 md:p-7">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "linear-gradient(var(--color-rule) 1px, transparent 1px), linear-gradient(90deg, var(--color-rule) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="relative z-10 flex min-h-[266px] flex-col justify-center gap-6">
            <div className="flex flex-col gap-4">
              {values.map((row) => (
                <BrowserToolsBenchmarkBar
                  key={`${activeMetricId}-${row.id}`}
                  label={row.label}
                  value={row.value}
                  display={row.display}
                  max={maxValue}
                  highlight={row.highlight}
                />
              ))}
            </div>
            <Text size="xs" className="leading-relaxed text-faint">
              Measured across 26 tasks on public websites with GPT 5.6 Sol. Best
              results taken from 3 runs.{" "}
              <a
                href={BENCHMARK_RESULTS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                data-fathom-event="Browser tools benchmarks results click"
              >
                Full method and results
              </a>
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}

const SOON_HATCH = {
  backgroundImage:
    "repeating-linear-gradient(315deg, color-mix(in oklch, var(--color-gray-12) 5%, transparent) 0, color-mix(in oklch, var(--color-gray-12) 5%, transparent) 1px, transparent 0, transparent 50%)",
  backgroundSize: "10px 10px",
} as const;

const READY_HATCH = {
  backgroundImage:
    "repeating-linear-gradient(315deg, color-mix(in oklch, var(--color-green-9) 18%, transparent) 0, color-mix(in oklch, var(--color-green-9) 18%, transparent) 1px, transparent 0, transparent 50%)",
  backgroundSize: "14px 14px",
} as const;

type IntegrationCardProps = {
  name: string;
  logoSrc: string;
  href?: string;
  status: "ready" | "soon";
  fathomEvent?: string;
  logoClassName?: string;
};

function IntegrationCard({
  name,
  logoSrc,
  href,
  status,
  fathomEvent,
  logoClassName = "",
}: IntegrationCardProps) {
  const soon = status === "soon";
  const external = Boolean(href?.startsWith("http"));
  const className = `w-[calc(50%-0.375rem)] sm:w-[calc(25%-0.5625rem)] ${
    soon
      ? "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-rule/60 bg-panel/20 no-underline opacity-35"
      : "group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-transparent no-underline transition-[border-color,box-shadow] duration-300 hover:border-accent/45 hover:shadow-[0_0_24px_-8px_color-mix(in_oklch,var(--color-green-9)_55%,transparent)]"
  }`;

  const content = (
    <>
      {soon ? (
        <span className="absolute top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-amber/40 bg-bg/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-amber">
          Coming soon
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="integration-hatch-motion pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={READY_HATCH}
        />
      )}
      <img
        src={logoSrc}
        alt=""
        className={
          soon
            ? `relative z-[1] max-h-[42%] max-w-[58%] object-contain opacity-70 ${logoClassName}`
            : `relative z-[1] max-h-[42%] max-w-[58%] object-contain opacity-45 transition-[opacity,transform,filter] duration-300 ease-out group-hover:scale-110 group-hover:opacity-100 group-hover:brightness-110 ${logoClassName}`
        }
      />
      {soon ? null : (
        <span className="pointer-events-none absolute inset-x-3 bottom-3 z-[1] text-center font-mono text-sm tracking-tight text-accent-bright opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          {name}
        </span>
      )}
    </>
  );

  if (href && !soon) {
    return (
      <a
        href={href}
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        className={className}
        data-fathom-event={fathomEvent}
        title={name}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={`${className} cursor-default`}
      style={soon ? SOON_HATCH : undefined}
      title={soon ? "Coming soon" : name}
    >
      {content}
    </div>
  );
}

const INTEGRATIONS: IntegrationCardProps[] = [
  {
    name: "AI SDK",
    logoSrc: "/logos/ai-sdk.svg",
    href: "/docs/browser-tools/adapters/ai-sdk",
    status: "ready",
    fathomEvent: "Browser tools AI SDK integration click",
    logoClassName: "max-h-[28%] max-w-[72%]",
  },
  {
    name: "Pi",
    logoSrc: "/logos/pi.svg",
    href: "/docs/browser-tools/adapters/pi",
    status: "ready",
    fathomEvent: "Browser tools Pi integration click",
    logoClassName: "brightness-0 invert",
  },
  {
    name: "MCP",
    logoSrc: "/logos/mcp.svg",
    href: "/docs/browser-tools/adapters/mcp",
    status: "ready",
    fathomEvent: "Browser tools MCP integration click",
    logoClassName: "max-h-[38%] max-w-[48%]",
  },
  {
    name: "Custom",
    logoSrc: "/logos/custom.svg",
    href: "/docs/browser-tools/adapters/custom",
    status: "ready",
    fathomEvent: "Browser tools Custom integration click",
  },
  {
    name: "Flue",
    logoSrc: "/logos/flue.svg",
    status: "soon",
  },
  {
    name: "Executor",
    logoSrc: "/logos/executor.png",
    status: "soon",
  },
  {
    name: "eve",
    logoSrc: "/logos/eve.svg",
    status: "soon",
  },
];

function IntegrationsSection() {
  return (
    <section className="px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[900px]">
        <div className="mx-auto mb-12 max-w-[620px] text-center">
          <Kicker className="mb-4">// INTEGRATIONS --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="pretty"
            className="mb-5 tracking-[-0.035em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            Use the agent stack you know.
          </Text>
          <Text as="p" wrap="pretty" className="leading-relaxed text-muted">
            Built-in adapters for AI SDK, Pi, and MCP, plus a custom path for
            anything else. More frameworks are on the way.
          </Text>
        </div>

        <div className="mx-auto flex max-w-[900px] flex-wrap justify-center gap-3">
          {INTEGRATIONS.map((integration) => (
            <IntegrationCard key={integration.name} {...integration} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductLinksSection() {
  return (
    <section className="px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-12">
          <Kicker className="mb-4">// MORE FROM LIBRETTO --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="pretty"
            className="tracking-[-0.035em] text-ink"
            htmlStyle={{ fontWeight: 300 }}
          >
            Build and repair browser workflows.
          </Text>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <a
            href="/cli"
            className="group rounded-xl border border-rule bg-panel/60 p-7 no-underline transition-colors hover:border-accent/40"
            data-fathom-event="Browser tools Libretto CLI click"
          >
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
              Libretto CLI
            </div>
            <Text
              as="h3"
              size="xl"
              wrap="pretty"
              className="mb-3 block text-ink group-hover:text-accent-bright"
            >
              Turn browser workflows into APIs.
            </Text>
            <Text
              as="p"
              size="sm"
              wrap="pretty"
              className="leading-relaxed text-muted"
            >
              Record a live workflow and save it as a reusable typescript file.
            </Text>
          </a>
          <a
            href="/debug-agents"
            className="group rounded-xl border border-rule bg-panel/60 p-7 no-underline transition-colors hover:border-accent/40"
            data-fathom-event="Browser tools Debug Agents click"
          >
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
              Debug Agents
            </div>
            <Text
              as="h3"
              size="xl"
              wrap="pretty"
              className="mb-3 block text-ink group-hover:text-accent-bright"
            >
              Fix failed browser runs.
            </Text>
            <Text
              as="p"
              size="sm"
              wrap="pretty"
              className="leading-relaxed text-muted"
            >
              Give a failed run to an agent. Get a tested pull request back.
            </Text>
          </a>
        </div>
      </div>
    </section>
  );
}

const BROWSER_TOOLS_FAQS = [
  {
    question: "Which integrations work today?",
    answer:
      "The package includes adapters for AI SDK, Pi, and MCP. The base tools are framework-neutral, so you can also wire them into your own agent loop.",
  },
  {
    question: "Which browser providers can I use?",
    answer:
      "Run Chromium on your machine with LocalBrowserProvider, or use the built-in providers for Libretto Cloud, Browserbase, Kernel, and Steel.",
  },
  {
    question: "Why does the SDK expose only six tools?",
    answer:
      "Most browser work needs two tools: browser_snapshot to read the page and browser_exec to run Playwright. The other four tools open, connect, inspect, and close browser sessions.",
  },
  {
    question: "Does Browser Tools SDK replace Playwright?",
    answer:
      "No. It gives an agent a small tool set and runs its browser_exec code through Playwright. You still have the Playwright API.",
  },
  {
    question: "Is Browser Tools SDK open source?",
    answer:
      "Yes. The package is available under the MIT license in the Libretto repository.",
  },
];

function BrowserToolsFaq() {
  return (
    <section className="section-crt px-6 py-24 md:px-12 md:py-32">
      <div className="relative mx-auto grid max-w-[900px] gap-12 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
        <div>
          <Kicker className="mb-4">// FAQ --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="pretty"
            className="tracking-[-0.035em] text-ink"
            htmlStyle={{ fontWeight: 300 }}
          >
            Common questions
          </Text>
        </div>
        <div className="border-t border-rule">
          {BROWSER_TOOLS_FAQS.map((item) => (
            <details
              key={item.question}
              className="group border-b border-rule [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
                {item.question}
                <span className="font-mono text-lg text-accent group-open:rotate-45">+</span>
              </summary>
              <Text
                as="p"
                size="sm"
                wrap="pretty"
                className="pb-6 leading-relaxed text-muted"
              >
                {item.answer}
              </Text>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="section-crt px-6 py-24 text-center md:px-12 md:py-32">
      <div className="relative mx-auto max-w-[720px]">
        <Kicker className="mb-4">// GET STARTED --</Kicker>
        <Text
          as="h2"
          size="4xl"
          style="serif"
          wrap="pretty"
          className="crt-glow mb-5 tracking-[-0.04em] text-ink"
          htmlStyle={{
            fontWeight: 300,
            fontSize: "clamp(38px, 5vw, 56px)",
            lineHeight: 1.04,
          }}
        >
          Add browser tools to your agent.
        </Text>
        <Text
          as="p"
          wrap="pretty"
          className="mx-auto mb-8 max-w-[520px] leading-relaxed text-muted"
        >
          Install the package. Keep your current model and agent framework.
        </Text>
        <ShellCommand
          ariaLabel="Copy browser tools install command"
          command={INSTALL_COMMAND}
          fathomEvent="Browser tools CTA install copy"
          className="mx-auto max-w-[390px] text-left"
        />
        <a
          href="https://github.com/saffron-health/libretto/tree/main/packages/browser-tools"
          className="mt-6 inline-block text-xs text-muted underline decoration-muted/50 underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
          data-fathom-event="Browser tools CTA github click"
          target="_blank"
          rel="noopener noreferrer"
        >
          VIEW SOURCE ON GITHUB →
        </a>
      </div>
    </section>
  );
}

export function BrowserToolsPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink [&>nav]:bg-bg/90">
      <Navbar />
      <BrowserToolsHero />
      <div className="section-rails relative mx-auto max-w-[1100px]">
        <SectionDivider />
        <BenchmarksSection />
        <SectionDivider />
        <IntegrationsSection />
        <SectionDivider />
        <ToolsSection />
        <SectionDivider />
        <ProductLinksSection />
        <SectionDivider />
        <BrowserToolsFaq />
        <SectionDivider />
        <FinalCta />
        <Footer />
      </div>
    </div>
  );
}
