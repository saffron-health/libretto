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
            {"// Integrates with Pi SDK, and more coming soon"}
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
    <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-6">
      <div className="text-accent-bright">{call}</div>
      <div className="mt-3 border-t border-rule/80 pt-3 text-muted">{result}</div>
    </pre>
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

const BENCHMARK_HARNESSES = [
  {
    name: "browser-tools",
    label: "Browser Tools",
    passed: "24/26",
    costPerPass: "$0.106",
    tokens: "1.45M",
    highlight: true,
  },
  {
    name: "dev-browser",
    label: "dev-browser",
    passed: "24/26",
    costPerPass: "$0.257",
    tokens: "3.51M",
    highlight: false,
  },
  {
    name: "agent-browser",
    label: "agent-browser",
    passed: "23/26",
    costPerPass: "$0.235",
    tokens: "2.29M",
    highlight: false,
  },
  {
    name: "playwright-cli",
    label: "playwright-cli",
    passed: "22/26",
    costPerPass: "$0.293",
    tokens: "3.48M",
    highlight: false,
  },
] as const;

function BenchmarksSection() {
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
            Same pass rate. 59% less cost.
          </Text>
          <Text as="p" wrap="pretty" className="leading-relaxed text-muted">
            On 26 live-site tasks, Browser Tools tied the top harness at 24/26
            and used 59% fewer tokens than the next tool at that score.
          </Text>
        </div>

        <div className="overflow-hidden rounded-xl border border-rule">
          <div className="hidden grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr] gap-4 border-b border-rule bg-panel/40 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint sm:grid">
            <span>Harness</span>
            <span>Passed</span>
            <span>Cost / pass</span>
            <span>Tokens</span>
          </div>
          {BENCHMARK_HARNESSES.map((row) => (
            <div
              key={row.name}
              className={`grid gap-2 border-b border-rule px-5 py-4 last:border-b-0 sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr] sm:items-center sm:gap-4 ${
                row.highlight ? "bg-green-3/25" : "bg-panel/20"
              }`}
            >
              <div className="font-mono text-sm text-ink">
                {row.label}
                {row.highlight ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-bright">
                    ours
                  </span>
                ) : null}
              </div>
              <div className="flex justify-between font-mono text-sm text-muted sm:block sm:text-ink">
                <span className="sm:hidden">Passed</span>
                <span>{row.passed}</span>
              </div>
              <div className="flex justify-between font-mono text-sm text-muted sm:block sm:text-ink">
                <span className="sm:hidden">Cost / pass</span>
                <span className={row.highlight ? "text-accent-bright" : undefined}>
                  {row.costPerPass}
                </span>
              </div>
              <div className="flex justify-between font-mono text-sm text-muted sm:block sm:text-ink">
                <span className="sm:hidden">Tokens</span>
                <span>{row.tokens}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Text as="p" className="text-xs leading-relaxed text-faint">
            Best result per harness across three Browser Use Cloud runs (July
            2026). GPT-5.6 Sol via Pi. Exploratory — not a causal ranking.
          </Text>
          <a
            href={BENCHMARK_RESULTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 font-mono text-xs text-muted underline decoration-muted/50 underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
            data-fathom-event="Browser tools benchmarks results click"
          >
            Full method and results →
          </a>
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
  const className = soon
    ? "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-rule/60 bg-panel/20 no-underline opacity-35"
    : "group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-transparent no-underline transition-[border-color,box-shadow] duration-300 hover:border-accent/45 hover:shadow-[0_0_24px_-8px_color-mix(in_oklch,var(--color-green-9)_55%,transparent)]";

  const content = (
    <>
      {soon ? (
        <span className="absolute top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-amber/40 bg-bg/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-amber">
          Coming soon
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="integration-hatch-motion pointer-events-none absolute inset-[12%] rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-100"
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

  if (href) {
    return (
      <a
        href={href}
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        className={className}
        style={soon ? SOON_HATCH : undefined}
        data-fathom-event={fathomEvent}
        title={soon ? "Coming soon" : name}
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
    name: "Custom",
    logoSrc: "/logos/custom.svg",
    href: "/docs/browser-tools/adapters/custom",
    status: "ready",
    fathomEvent: "Browser tools Custom integration click",
  },
  {
    name: "Flue",
    logoSrc: "/logos/flue.svg",
    href: "https://flueframework.com/",
    status: "soon",
    fathomEvent: "Browser tools Flue integration click",
  },
  {
    name: "Executor",
    logoSrc: "/logos/executor.png",
    href: "https://executor.sh/",
    status: "soon",
    fathomEvent: "Browser tools Executor integration click",
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
            Use the agent framework you know.
          </Text>
          <Text as="p" wrap="pretty" className="leading-relaxed text-muted">
            Built-in adapters for AI SDK and Pi, plus a custom path for anything
            else. More frameworks are on the way.
          </Text>
        </div>

        <div className="mx-auto grid max-w-[720px] grid-cols-2 gap-3 sm:grid-cols-3">
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
    question: "Which agent frameworks work today?",
    answer:
      "The package includes adapters for AI SDK and Pi. The base tools are framework-neutral, so you can also wire them into your own agent loop.",
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
