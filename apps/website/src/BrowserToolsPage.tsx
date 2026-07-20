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
            className="crt-glow mb-6 max-w-[620px] tracking-[-0.045em] text-ink [text-wrap:balance]"
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
            Let any AI agent open a real browser, read the page, and act with
            Playwright.
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

function InstallSection() {
  return (
    <section className="px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto grid max-w-[900px] gap-10 md:grid-cols-[0.8fr_1.2fr] md:items-center">
        <div>
          <Kicker className="mb-4">// ZERO TO BROWSER --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            className="tracking-[-0.035em] text-ink"
            htmlStyle={{ fontWeight: 300, lineHeight: 1.05 }}
          >
            Install one package.
          </Text>
        </div>
        <div>
          <ShellCommand
            ariaLabel="Copy npm install command"
            command={INSTALL_COMMAND}
            fathomEvent="Browser tools install section copy"
          />
          <Text as="p" size="sm" className="mt-4 leading-relaxed text-muted">
            Use your model and agent loop. The SDK opens and closes browser
            sessions and tracks each page.
          </Text>
        </div>
      </div>
    </section>
  );
}

function ToolCard({
  index,
  name,
  label,
  children,
}: {
  index: string;
  name: string;
  label: string;
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
      <Text as="h3" size="xl" className="mb-3 text-accent-bright">
        {name}
      </Text>
      <Text as="p" size="sm" className="max-w-[390px] leading-relaxed text-muted">
        {children}
      </Text>
    </div>
  );
}

function ToolsSection() {
  return (
    <section className="section-crt px-6 py-24 md:px-12 md:py-32">
      <div className="relative mx-auto max-w-[920px]">
        <div className="mx-auto mb-14 max-w-[620px] text-center">
          <Kicker className="mb-4">// OBSERVE, THEN ACT --</Kicker>
          <Text
            as="h2"
            size="4xl"
            style="serif"
            className="mb-5 tracking-[-0.035em] text-ink [text-wrap:balance]"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
            }}
          >
            See the page. Then act.
          </Text>
          <Text as="p" className="leading-relaxed text-muted">
            The agent reads a compact page snapshot, decides what to do, and
            runs Playwright code.
          </Text>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ToolCard index="01" label="See the page" name="browser_snapshot">
            Returns a compact accessibility tree with stable refs. The agent
            can read the page structure without raw HTML.
          </ToolCard>
          <ToolCard index="02" label="Use the browser" name="browser_exec">
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

function FinalCta() {
  return (
    <section className="section-crt px-6 py-24 text-center md:px-12 md:py-32">
      <div className="relative mx-auto max-w-[720px]">
        <Kicker className="mb-4">// GET STARTED --</Kicker>
        <Text
          as="h2"
          size="4xl"
          style="serif"
          className="crt-glow mb-5 tracking-[-0.04em] text-ink [text-wrap:balance]"
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
        <InstallSection />
        <SectionDivider />
        <ToolsSection />
        <SectionDivider />
        <BenchmarksPlaceholder />
        <SectionDivider />
        <FinalCta />
        <Footer />
      </div>
    </div>
  );
}
