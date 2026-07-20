import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Text } from "./components/Text";
import { Kicker } from "./components/Kicker";
import { SectionDivider } from "./components/SectionDivider";
import { ShellCommand } from "./components/ShellCommand";

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
          <span className="text-faint">import</span>
          <span className="text-ink"> {"{ generateText }"} </span>
          <span className="text-faint">from</span>
          <span className="text-amber"> &quot;ai&quot;</span>
          <span className="text-faint">;</span>
          {"\n"}
          <span className="text-faint">import</span>
          <span className="text-ink"> {"{\n  createAiSdkBrowserTools,\n}"} </span>
          <span className="text-faint">from</span>
          <span className="text-amber"> &quot;libretto-browser-tools/ai-sdk&quot;</span>
          <span className="text-faint">;</span>
          {"\n"}
          <span className="text-faint">import</span>
          <span className="text-ink"> {"{\n  LocalBrowserProvider,\n}"} </span>
          <span className="text-faint">from</span>
          <span className="text-amber"> &quot;libretto-browser-tools&quot;</span>
          <span className="text-faint">;</span>
          {"\n\n"}
          <span className="text-faint">const</span>
          <span className="text-ink"> provider = </span>
          <span className="text-faint">new</span>
          <span className="text-accent-bright"> LocalBrowserProvider</span>
          <span className="text-ink">();</span>
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
      <div className="flex items-center gap-3 border-t border-rule bg-green-3/20 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-bright">
        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
        6 browser tools attached
      </div>
    </div>
  );
}

function BrowserToolsHero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 md:px-8 md:pt-24 md:pb-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_64%_28%,color-mix(in_oklch,var(--color-green-9)_11%,transparent),transparent_48%)]" />
      <div className="relative mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20">
        <div>
          <Kicker className="mb-5">// BROWSER TOOLS SDK --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            wrap="balance"
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
            className="mb-9 max-w-[560px] leading-relaxed text-muted [text-wrap:pretty]"
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
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            <span>Open source</span>
            <span aria-hidden="true">/</span>
            <span>TypeScript</span>
            <span aria-hidden="true">/</span>
            <span>AI SDK adapter</span>
          </div>
        </div>
        <CodeWindow />
      </div>
    </section>
  );
}

function ToolCard({
  index,
  name,
  label,
  example,
  children,
}: {
  index: string;
  name: string;
  label: string;
  example: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-rule bg-panel/70 p-6 md:p-8">
      <div className="absolute top-0 right-0 border-b border-l border-rule px-3 py-2 font-mono text-[10px] text-faint">
        {index}
      </div>
      <div className="mb-8 font-mono text-[10px] uppercase tracking-[0.15em] text-amber">
        {label}
      </div>
      <Text as="h3" size="xl" wrap="balance" className="mb-3 text-accent-bright">
        {name}
      </Text>
      <Text as="p" size="sm" className="max-w-[390px] leading-relaxed text-muted">
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
            wrap="balance"
            className="mb-5 tracking-[-0.035em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            Two tools do most of the work.
          </Text>
          <Text as="p" className="leading-relaxed text-muted">
            The agent reads a short page snapshot, then runs the Playwright code
            it needs.
          </Text>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ToolCard
            index="01"
            label="See the page"
            name="browser_snapshot"
            example={
              <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-6 text-muted">
                <span className="text-faint">&lt;page title=&quot;Hacker News&quot;&gt;</span>
                {"\n  "}
                <span className="text-ink">heading</span> &quot;Hacker News&quot;
                {"\n  "}
                <span className="text-accent-bright">link</span> &quot;Show HN:
                Browser Tools&quot; <span className="text-amber">[ref=l12]</span>
                {"\n  "}
                <span className="text-accent-bright">link</span> &quot;42
                comments&quot; <span className="text-amber">[ref=l13]</span>
              </pre>
            }
          >
            Returns a compact accessibility tree with stable refs. The agent
            can read the page structure without raw HTML.
          </ToolCard>
          <ToolCard
            index="02"
            label="Use the browser"
            name="browser_exec"
            example={
              <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-6 text-muted">
                <span className="text-faint">const</span> story = page
                {"\n  "}.locator(
                <span className="text-amber">&quot;.titleline &gt; a&quot;</span>)
                {"\n  "}.first();
                {"\n"}
                <span className="text-faint">const</span> title ={" "}
                <span className="text-faint">await</span> story.innerText();
                {"\n"}
                <span className="text-faint">await</span> story.click();
                {"\n"}
                <span className="text-faint">return</span> {"{ title, url: page.url() };"}
              </pre>
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

function BenchmarksPlaceholder() {
  return (
    <section className="px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-10 flex items-end justify-between gap-8">
          <div>
            <Kicker className="mb-4">// BENCHMARKS --</Kicker>
            <Text
              as="h2"
              size="4xl"
              style="serif"
              wrap="balance"
              className="tracking-[-0.035em] text-ink"
              htmlStyle={{ fontWeight: 300 }}
            >
              Benchmarks are in progress.
            </Text>
          </div>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.15em] text-amber sm:block">
            Results incoming
          </span>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-rule bg-panel/50 p-8 md:p-12">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,color-mix(in_oklch,var(--color-green-9)_3%,transparent)_12px,color-mix(in_oklch,var(--color-green-9)_3%,transparent)_24px)]" />
          <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <Text as="p" className="max-w-[560px] leading-relaxed text-muted">
              We are measuring task success, speed, and token use across common
              browser tools. We will publish the method and results when the
              tests are complete.
            </Text>
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-amber/30 bg-amber/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber">
              <span className="size-1.5 animate-pulse rounded-full bg-amber" />
              Running
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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
            wrap="balance"
            className="mb-5 tracking-[-0.035em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            Use the agent framework you know.
          </Text>
          <Text as="p" className="leading-relaxed text-muted">
            Built-in adapters give AI SDK and Pi the right tool shape and return
            format.
          </Text>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <a
            href="https://ai-sdk.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-h-44 items-center justify-between rounded-xl border border-rule bg-panel/60 p-8 no-underline transition-colors hover:border-accent/40"
            data-fathom-event="Browser tools AI SDK integration click"
          >
            <img src="/logos/ai-sdk.svg" alt="AI SDK" className="h-10 w-auto max-w-40" />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent-bright">
              Ready
            </span>
          </a>
          <a
            href="https://pi.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-h-44 items-center justify-between rounded-xl border border-rule bg-panel/60 p-8 no-underline transition-colors hover:border-accent/40"
            data-fathom-event="Browser tools Pi integration click"
          >
            <span className="flex items-center gap-4">
              <img src="/logos/pi.svg" alt="" className="size-14" />
              <span className="font-mono text-2xl text-ink">Pi</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent-bright">
              Ready
            </span>
          </a>
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-rule px-6 py-5 text-center font-mono text-xs text-muted">
          More framework adapters are coming.
        </div>
      </div>
    </section>
  );
}

function WhyBuiltSection() {
  return (
    <section className="section-crt px-6 py-24 md:px-12 md:py-32">
      <div className="relative mx-auto grid max-w-[900px] gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
        <div>
          <Kicker className="mb-4">// WHY WE BUILT IT --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            wrap="balance"
            className="tracking-[-0.035em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            Models already know Playwright.
          </Text>
        </div>
        <div className="space-y-5">
          <Text as="p" size="lg" className="leading-relaxed text-ink">
            Browser tools often make agents choose among many narrow actions or
            read a full page of raw data.
          </Text>
          <Text as="p" className="leading-relaxed text-muted">
            Both waste context and make each step harder. Browser Tools SDK uses
            six tools instead. The agent reads a compact page view, then writes
            the Playwright code it needs.
          </Text>
          <Text as="p" className="leading-relaxed text-muted">
            You keep your model, agent loop, and browser provider.
          </Text>
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
            wrap="balance"
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
            <div className="mb-8 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
              Libretto CLI
            </div>
            <Text
              as="h3"
              size="xl"
              wrap="balance"
              className="mb-3 block text-ink group-hover:text-accent-bright"
            >
              Turn browser workflows into APIs.
            </Text>
            <Text as="p" size="sm" className="leading-relaxed text-muted">
              Record a live workflow and save it as a reusable TypeScript script.
            </Text>
          </a>
          <a
            href="/debug-agents"
            className="group rounded-xl border border-rule bg-panel/60 p-7 no-underline transition-colors hover:border-accent/40"
            data-fathom-event="Browser tools Debug Agents click"
          >
            <div className="mb-8 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
              Debug Agents
            </div>
            <Text
              as="h3"
              size="xl"
              wrap="balance"
              className="mb-3 block text-ink group-hover:text-accent-bright"
            >
              Fix failed browser runs.
            </Text>
            <Text as="p" size="sm" className="leading-relaxed text-muted">
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
            wrap="balance"
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
              <Text as="p" size="sm" className="pb-6 leading-relaxed text-muted">
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
          wrap="balance"
          className="crt-glow mb-5 tracking-[-0.04em] text-ink"
          htmlStyle={{
            fontWeight: 300,
            fontSize: "clamp(38px, 5vw, 56px)",
            lineHeight: 1.04,
          }}
        >
          Add browser tools to your agent.
        </Text>
        <Text as="p" className="mx-auto mb-8 max-w-[520px] leading-relaxed text-muted">
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
        <BenchmarksPlaceholder />
        <SectionDivider />
        <IntegrationsSection />
        <SectionDivider />
        <WhyBuiltSection />
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
