import type { ReactNode } from "react";
import { AsciiLibretto } from "../brand";
import { Button } from "../components/Button";
import { Footer } from "../components/Footer";
import { Kicker } from "../components/Kicker";
import { Navbar } from "../components/Navbar";
import { Panel } from "../components/Panel";
import { SectionHeading } from "../components/SectionHeading";
import { Text } from "../components/Text";

const linkClass =
  "text-accent-bright underline decoration-accent/40 underline-offset-4 transition-colors hover:text-ink";

interface ComparisonRow {
  label: string;
  browserUse: ReactNode;
  browserUseMark?: "positive" | "tradeoff";
  libretto: ReactNode;
  librettoMark?: "positive" | "tradeoff";
}

const comparisonRows: ComparisonRow[] = [
  {
    label: "Execution model",
    browserUse:
      "An LLM-driven agent observes the page, reasons, and decides actions at runtime.",
    libretto:
      "A workflow is recorded once, then compiled into a deterministic Playwright-plus-API script.",
  },
  {
    label: "Reliability across runs",
    browserUse:
      "Flexible, but the agent can choose different actions when page state or model output shifts.",
    browserUseMark: "tradeoff",
    libretto:
      "The generated script follows the same inspected code path unless you change the script.",
    librettoMark: "positive",
  },
  {
    label: "Speed",
    browserUse:
      "~79.5s in Libretto's internal benchmark of the same multi-step workflow.",
    browserUseMark: "tradeoff",
    libretto:
      "~16.3s in the same Libretto internal benchmark, about 5x faster.",
    librettoMark: "positive",
  },
  {
    label: "Debuggability",
    browserUse:
      "You inspect agent traces and model decisions after the run.",
    browserUseMark: "tradeoff",
    libretto:
      "You debug plain code, recorded actions, network calls, and normal Playwright failures.",
    librettoMark: "positive",
  },
  {
    label: "Token cost per run",
    browserUse:
      "Runtime reasoning consumes tokens on every execution.",
    browserUseMark: "tradeoff",
    libretto:
      "The generated workflow runs as code, so LLM reasoning is not required on every execution.",
    librettoMark: "positive",
  },
  {
    label: "Output you can inspect and own",
    browserUse:
      "The durable artifact is usually the prompt, task definition, and trace.",
    browserUseMark: "tradeoff",
    libretto:
      "The durable artifact is a readable script teams can inspect, debug, version, and deploy.",
    librettoMark: "positive",
  },
  {
    label: "Unknown or changing pages",
    browserUse:
      "Strong fit: the runtime agent can adapt while exploring a page it has not seen before.",
    browserUseMark: "positive",
    libretto:
      "Better after the workflow is known and stable enough to encode as a maintained script.",
    librettoMark: "tradeoff",
  },
  {
    label: "Deployment",
    browserUse:
      "Deploy an agent runtime, model access, browser infrastructure, and task prompts.",
    libretto:
      "Deploy the generated automation code as part of your normal codebase or Libretto workflow runtime.",
  },
];

interface FAQItem {
  question: string;
  answer: ReactNode;
}

const faqItems: FAQItem[] = [
  {
    question: "Can I migrate a Browser Use task to Libretto?",
    answer:
      "Yes, when the task has become a known repeatable workflow. Use Browser Use-style exploration to understand the path, then record and compile the workflow in Libretto so future runs execute as deterministic code.",
  },
  {
    question: "Is Libretto open source?",
    answer: (
      <>
        Yes. Libretto is an open-source CLI. You can start from the docs or the
        project website at{" "}
        <a href="https://libretto.sh" className={linkClass}>
          libretto.sh
        </a>
        .
      </>
    ),
  },
  {
    question: "Does Libretto use an LLM at runtime?",
    answer:
      "Not by default for the workflow execution path described here. Libretto uses a coding agent while building and maintaining the workflow, then runs the generated script directly instead of asking an LLM to re-reason through every run.",
  },
  {
    question: "Is Browser Use the wrong tool for production?",
    answer:
      "Not categorically. It can be the right tool when flexibility matters more than repeatability, especially for open-ended tasks. Libretto is a better fit when a known workflow needs to run many times with predictable behavior, lower per-run cost, and inspectable code.",
  },
  {
    question: "What kinds of sites is Libretto designed for?",
    answer:
      "Libretto has been battle-tested on complex healthcare and legacy portals: messy, fragile, real-world sites where teams need durable automation rather than one-off exploration.",
  },
];

function ArticleSection({
  children,
  kicker,
  title,
}: {
  children: ReactNode;
  kicker: string;
  title: ReactNode;
}) {
  return (
    <section className="border-t border-rule py-14">
      <Kicker className="mb-3 text-sm text-accent">{kicker}</Kicker>
      <SectionHeading size="sm" className="mb-7 normal-case">
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}

function PositiveMark() {
  return <span className="font-medium text-accent-bright">✓</span>;
}

function TradeoffMark() {
  return <span className="font-medium text-muted/60">—</span>;
}

function ComparisonMark({ kind }: { kind?: "positive" | "tradeoff" }) {
  if (kind === "positive") {
    return <PositiveMark />;
  }

  if (kind === "tradeoff") {
    return <TradeoffMark />;
  }

  return null;
}

function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-[3.75px] border border-rule bg-panel/80">
      <table className="w-full min-w-[760px] border-collapse border border-rule text-left text-sm leading-relaxed text-muted">
        <thead>
          <tr className="border-b border-rule">
            <th className="w-[22%] border border-rule px-4 py-3 font-medium uppercase tracking-[0.08em] text-muted/80">
              Dimension
            </th>
            <th className="w-[39%] border border-rule px-4 py-3 font-medium uppercase tracking-[0.08em] text-muted/80">
              Browser Use
            </th>
            <th className="w-[39%] border border-rule bg-green-3/35 px-4 py-3 font-medium uppercase tracking-[0.08em] text-accent-bright">
              Libretto
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisonRows.map((row) => (
            <tr key={row.label} className="border-b border-rule last:border-b-0">
              <th className="border border-rule px-4 py-4 align-top font-medium text-ink">
                {row.label}
              </th>
              <td className="border border-rule px-4 py-4 align-top">
                <ComparisonMark kind={row.browserUseMark} /> <span>{row.browserUse}</span>
              </td>
              <td className="border border-rule bg-green-3/20 px-4 py-4 align-top text-ink">
                <ComparisonMark kind={row.librettoMark} /> <span>{row.libretto}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FAQList() {
  return (
    <div className="border-t border-rule">
      {faqItems.map((item) => (
        <details key={item.question} className="group border-b border-rule py-5">
          <summary className="cursor-pointer list-none text-base font-medium text-ink outline-none transition-colors hover:text-accent-bright focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-details-marker]:hidden">
            <span className="mr-3 text-accent group-open:hidden">+</span>
            <span className="mr-3 hidden text-muted group-open:inline">−</span>
            {item.question}
          </summary>
          <Text as="p" size="sm" className="mt-4 max-w-[700px] leading-relaxed text-muted">
            {item.answer}
          </Text>
        </details>
      ))}
    </div>
  );
}

export function BrowserUsePage() {
  return (
    <div className="crt-page flex min-h-screen flex-col bg-bg text-ink">
      <Navbar />
      <main className="section-rails relative mx-auto mt-16 w-full max-w-[1100px] flex-1 px-8">
        <article className="mx-auto max-w-[820px] pb-20">
          <header className="pb-16">
            <div className="mb-8 overflow-hidden">
              <AsciiLibretto decorative className="text-[4px] text-accent sm:text-[5px] md:text-[6px]" />
            </div>
            <Kicker className="mb-4 text-accent">// COMPARISON --</Kicker>
            <Text
              as="h1"
              size="5xl"
              style="serif"
              className="crt-glow mb-7 max-w-[780px] font-[300] leading-[1.05] tracking-[-0.04em] text-ink [text-wrap:balance]"
              htmlStyle={{ fontSize: "clamp(40px, 6vw, 72px)" }}
            >
              Libretto vs Browser Use: deterministic scripts vs a runtime agent.
            </Text>
            <Text as="p" size="lg" className="max-w-[720px] leading-relaxed text-muted">
              Browser Use is a strong fit when you want an agent to figure out a browser task at runtime. Libretto is for the moment after that: when the workflow is known, needs to run reliably, and should become fast, inspectable code your team owns.
            </Text>
          </header>

          <Panel padding="lg" radius="md" className="mb-12 border-accent/20 bg-green-2/35">
            <Kicker className="mb-3 text-sm text-accent">// SHORT VERSION --</Kicker>
            <ul className="space-y-3 leading-relaxed text-muted">
              <li>
                Use Browser Use for open-ended exploration, one-off tasks, rapidly changing pages, and prototypes where maintaining a script would be premature.
              </li>
              <li>
                Use Libretto when a workflow is repeated enough that speed, determinism, debuggability, and per-run cost matter.
              </li>
              <li>
                In Libretto's own internal benchmark on the same multi-step workflow, a Libretto-generated script completed in ~16.3 seconds versus ~79.5 seconds for the runtime-agent approach.
              </li>
            </ul>
          </Panel>

          <ArticleSection kicker="// HOW IT WORKS --" title="Browser Use runs an agent at execution time">
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Browser Use is a popular open-source library for giving an LLM-driven agent control of a browser. On each run, the agent observes the page, reasons about the current state, decides the next action, and continues until the task is complete or stuck.
              </p>
              <p>
                That runtime-agent model is useful precisely because it is flexible. If the page is unfamiliar, the task is exploratory, or the target keeps changing, you may not want to encode a maintained script yet. You can point the agent at the task and let it adapt.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// HOW LIBRETTO WORKS --" title="Libretto records once, then compiles to code">
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto takes a different path. A coding agent uses the CLI with a live browser to inspect pages, record a workflow, capture useful network calls, and turn the result into a deterministic script. The script can combine Playwright interactions with direct in-session API calls when the browser reveals a cleaner underlying request.
              </p>
              <p>
                The important shift is ownership. The output is plain code: readable, inspectable, debuggable, versionable, and deployable. Instead of asking a model to rediscover the workflow every time, you run the script you have already inspected.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// HEAD TO HEAD --" title="Comparison table">
            <ComparisonTable />
          </ArticleSection>

          <ArticleSection kicker="// USE BROWSER USE WHEN --" title="When to use Browser Use instead">
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Browser Use is the more natural choice when the browser task is not yet well understood. If you are exploring a new site, asking an agent to gather information once, or working with pages that change faster than you can justify maintaining automation code, runtime reasoning is a feature, not a bug.
              </p>
              <p>
                It is also a good prototyping tool. You can learn whether a workflow is possible before investing in selectors, API-call extraction, error handling, and deployment. For many internal or one-off tasks, that trade-off is entirely reasonable.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// USE LIBRETTO WHEN --" title="When Libretto is the better choice">
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto is better once the workflow is known and repeated. At that point, you usually want the browser automation to behave like production code: predictable across runs, cheap to execute, easy to debug, and reviewable in pull requests.
              </p>
              <p>
                This matters most on fragile real-world sites. Libretto has been battle-tested on complex healthcare and legacy portals where small UI changes, hidden network calls, and brittle state can make pure runtime interaction slow and hard to reason about. Recording the workflow and compiling it into code gives teams something concrete to maintain.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// FAQ --" title="Short FAQ">
            <FAQList />
          </ArticleSection>

          <section className="border-t border-rule py-14">
            <Kicker className="mb-3 text-sm text-accent">// NEXT STEP --</Kicker>
            <Text as="h2" size="3xl" style="serif" className="mb-5 font-[300] leading-tight text-ink">
              Try turning one known workflow into a script.
            </Text>
            <Text as="p" size="md" className="mb-7 max-w-[640px] leading-relaxed text-muted">
              Start with a workflow you already understand, record it with Libretto, then inspect the generated code before you run it again.
            </Text>
            <div className="flex flex-wrap items-center gap-4">
              <Button href="/docs/get-started/quickstart" data-fathom-event="Browser Use comparison docs click">
                Go to docs
              </Button>
              <a
                href="https://libretto.sh"
                className="text-sm text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-accent-bright"
                data-fathom-event="Browser Use comparison homepage click"
              >
                libretto.sh
              </a>
            </div>
          </section>
        </article>
        <Footer />
      </main>
    </div>
  );
}
