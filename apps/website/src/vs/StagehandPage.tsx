import { useEffect } from "react";
import type { ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript.js";
import { AppLink } from "../routing";
import { AsciiLibretto } from "../brand";
import { Button } from "../components/Button";
import { Footer } from "../components/Footer";
import { Kicker } from "../components/Kicker";
import { Navbar } from "../components/Navbar";
import { Panel } from "../components/Panel";
import { SectionHeading } from "../components/SectionHeading";
import { Text } from "../components/Text";

interface ComparisonRow {
  label: string;
  stagehand: ReactNode;
  stagehandMark?: "positive" | "tradeoff";
  libretto: ReactNode;
  librettoMark?: "positive" | "tradeoff";
}

const comparisonRows: ComparisonRow[] = [
  {
    label: "Core model",
    stagehand:
      "A TypeScript/JavaScript framework for mixing browser code with AI primitives like act(), observe(), extract(), and agent().",
    stagehandMark: "positive",
    libretto:
      "An open-source CLI for coding agents that records known workflows and turns them into deterministic automation scripts.",
    librettoMark: "positive",
  },
  {
    label: "Runtime execution",
    stagehand:
      "Natural-language actions and extraction generally call a model at runtime unless you are replaying cached or explicit actions.",
    stagehandMark: "tradeoff",
    libretto:
      "The generated workflow runs as code; the agent helps build and maintain the script, not re-reason through every execution.",
    librettoMark: "positive",
  },
  {
    label: "Artifact you own",
    stagehand:
      "Your app code plus Stagehand instructions, cached actions, traces, and Browserbase session context when you use the hosted path.",
    stagehandMark: "tradeoff",
    libretto:
      "A plain script your team can read, inspect, debug, version, and deploy like the rest of your codebase.",
    librettoMark: "positive",
  },
  {
    label: "Determinism",
    stagehand:
      "Strongest when replaying explicit observed actions; less deterministic when fresh natural-language act() or agent() calls are used.",
    stagehandMark: "tradeoff",
    libretto:
      "Designed around repeatable script execution once the workflow has been recorded and reviewed.",
    librettoMark: "positive",
  },
  {
    label: "Caching",
    stagehand:
      "Action caching can save tokens and replay prior actions; self-healing may call AI again when a page changes.",
    stagehandMark: "positive",
    libretto:
      "Avoids the runtime cache question for known workflows by compiling the workflow into maintained code.",
    librettoMark: "positive",
  },
  {
    label: "Playwright relationship",
    stagehand:
      "Works with Playwright-style browser control and can bridge to Playwright pages, but exposes its own AI action model.",
    stagehandMark: "positive",
    libretto:
      "Combines Playwright with direct in-session API calls captured from the browser workflow.",
    librettoMark: "positive",
  },
  {
    label: "Direct API-call shortcuts",
    stagehand:
      "Best known for browser actions, extraction, and agent primitives; direct API-call shortcutting is not the central abstraction.",
    stagehandMark: "tradeoff",
    libretto:
      "Can replace slow UI steps with direct in-session API calls when the workflow exposes cleaner network requests.",
    librettoMark: "positive",
  },
  {
    label: "Cloud story",
    stagehand:
      "Local mode exists, but Browserbase is the first-class cloud path and the natural production on-ramp.",
    stagehandMark: "positive",
    libretto:
      "Generated scripts are plain code you can run in your own infrastructure, Libretto Cloud, or supported browser providers.",
    librettoMark: "positive",
  },
  {
    label: "Best fit",
    stagehand:
      "Apps that want runtime AI flexibility inside a TypeScript browser automation framework, especially on Browserbase.",
    stagehandMark: "positive",
    libretto:
      "Known, repeated workflows that need to become fast, deterministic scripts with no inference on every run.",
    librettoMark: "positive",
  },
];

interface FAQItem {
  question: string;
  answer: ReactNode;
}

const faqItems: FAQItem[] = [
  {
    question: "Is Stagehand open source?",
    answer: (
      <>
        Yes. Stagehand is open source and MIT-licensed in the Browserbase GitHub
        repository. Libretto is also open source.
      </>
    ),
  },
  {
    question: "Does Stagehand run without LLM inference?",
    answer:
      "Sometimes. Stagehand can replay cached or explicit observed actions, which can avoid model calls for those steps. But natural-language act(), observe(), extract(), and agent() workflows are runtime AI primitives, and self-healing can involve AI again when the page changes.",
  },
  {
    question: "Is Libretto just a Stagehand alternative without Browserbase?",
    answer:
      "No. The bigger difference is the artifact. Stagehand gives you a framework for mixing code and AI primitives at runtime. Libretto uses a coding agent to turn a known workflow into a deterministic script your team owns. Libretto can still run against hosted browser providers when that is the right infrastructure choice.",
  },
  {
    question: "Can I use both?",
    answer:
      "Yes. Stagehand can be useful while exploring dynamic flows or building TypeScript apps that need runtime AI actions. Libretto is a better fit when a workflow has graduated from exploration into code you want to run repeatedly.",
  },
  {
    question: "Which one is better for legacy portals?",
    answer:
      "It depends on whether the workflow is known. Stagehand is useful when runtime adaptation is valuable. Libretto is built for repeated portal workflows where teams want deterministic scripts, inspectable code, and fewer model-dependent decisions in production.",
  },
];

const stagehandExample = String.raw`import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "BROWSERBASE" });
await stagehand.init();

const page = stagehand.context.pages()[0];
await page.goto("https://portal.example.com");

await stagehand.act("open the latest authorization request");

const result = await stagehand.extract(
  "extract the member name and current status",
  z.object({
    memberName: z.string(),
    status: z.string(),
  }),
);`;

const librettoExample = String.raw`import { workflow } from "libretto";
import { z } from "zod";

export default workflow("readAuthorizationStatus", {
  input: z.object({ authorizationId: z.string() }),
  output: z.object({ memberName: z.string(), status: z.string() }),
  async handler({ page }, input) {
    await page.goto("https://portal.example.com/authorizations");

    const response = await page.request.post(
      "https://portal.example.com/api/authorizations/detail",
      { data: { id: input.authorizationId } },
    );

    const authorization = await response.json();
    return {
      memberName: authorization.member.name,
      status: authorization.status,
    };
  },
});`;

function setMetaContent(selector: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    const property = selector.match(/\[property="([^"]+)"\]/)?.[1];
    const name = selector.match(/\[name="([^"]+)"\]/)?.[1];

    if (property) {
      element.setAttribute("property", property);
    }
    if (name) {
      element.setAttribute("name", name);
    }

    document.head.append(element);
  }

  element.content = content;
}

function setCanonicalHref(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }

  element.href = href;
}

function StagehandPageMeta() {
  useEffect(() => {
    const title =
      "Libretto vs Stagehand: compiled scripts vs runtime AI primitives";
    const description =
      "A developer-focused comparison of Libretto and Browserbase Stagehand for AI browser automation: act(), observe(), caching, deterministic scripts, and runtime inference trade-offs.";
    const url = "https://libretto.sh/vs/stagehand";

    document.title = title;
    setCanonicalHref(url);
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:type"]', "article");
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[property="og:url"]', url);
    setMetaContent('meta[name="twitter:card"]', "summary");
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);
  }, []);

  return null;
}

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
              Stagehand
            </th>
            <th className="w-[39%] border border-rule bg-green-3/35 px-4 py-3 font-medium uppercase tracking-[0.08em] text-accent-bright">
              Libretto
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisonRows.map((row) => (
            <tr
              key={row.label}
              className="border-b border-rule last:border-b-0"
            >
              <th className="border border-rule px-4 py-4 align-top font-medium text-ink">
                {row.label}
              </th>
              <td className="border border-rule px-4 py-4 align-top">
                <ComparisonMark kind={row.stagehandMark} />{" "}
                <span>{row.stagehand}</span>
              </td>
              <td className="border border-rule bg-green-3/20 px-4 py-4 align-top text-ink">
                <ComparisonMark kind={row.librettoMark} />{" "}
                <span>{row.libretto}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const highlightedCode = Prism.highlight(
    code,
    Prism.languages.typescript,
    "typescript",
  );

  return (
    <div className="overflow-hidden rounded-[3.75px] border border-rule bg-[#0f120f]">
      <div className="border-b border-rule bg-panel px-4 py-2">
        <Text size="xs" className="uppercase tracking-[0.08em] text-muted/70">
          {label}
        </Text>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-muted">
        <code
          className="font-mono text-[#e6edf3] [&_.token.boolean]:text-[#79c0ff] [&_.token.builtin]:text-[#ffa657] [&_.token.class-name]:text-[#ffa657] [&_.token.comment]:text-[#8b949e] [&_.token.function]:text-[#d2a8ff] [&_.token.keyword]:text-[#ff7b72] [&_.token.number]:text-[#79c0ff] [&_.token.operator]:text-[#ff7b72] [&_.token.property]:text-[#79c0ff] [&_.token.punctuation]:text-[#c9d1d9] [&_.token.string]:text-[#a5d6ff] [&_.token.variable]:text-[#ffa657]"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
}

function CodeComparison() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CodeBlock code={stagehandExample} label="Stagehand: runtime AI primitive" />
      <CodeBlock code={librettoExample} label="Libretto: generated workflow code" />
    </div>
  );
}

function FAQList() {
  return (
    <div className="border-t border-rule">
      {faqItems.map((item) => (
        <details
          key={item.question}
          className="group border-b border-rule py-5"
        >
          <summary className="cursor-pointer list-none text-base font-medium text-ink outline-none transition-colors hover:text-accent-bright focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-details-marker]:hidden">
            <span className="mr-3 text-accent group-open:hidden">+</span>
            <span className="mr-3 hidden text-muted group-open:inline">−</span>
            {item.question}
          </summary>
          <Text
            as="p"
            size="sm"
            className="mt-4 max-w-[700px] leading-relaxed text-muted"
          >
            {item.answer}
          </Text>
        </details>
      ))}
    </div>
  );
}

export function StagehandPage() {
  return (
    <div className="crt-page flex min-h-screen flex-col bg-bg text-ink">
      <StagehandPageMeta />
      <Navbar />
      <main className="section-rails relative mx-auto mt-16 w-full max-w-[1100px] flex-1 px-8">
        <article className="mx-auto max-w-[820px] pb-20">
          <header className="pb-16">
            <div className="mb-8 overflow-hidden">
              <AsciiLibretto
                decorative
                className="text-[4px] text-accent sm:text-[5px] md:text-[6px]"
              />
            </div>
            <Kicker className="mb-4 text-accent">// COMPARISON --</Kicker>
            <Text
              as="h1"
              size="5xl"
              style="serif"
              className="crt-glow mb-7 max-w-[780px] font-[300] leading-[1.05] tracking-[-0.04em] text-ink [text-wrap:balance]"
              htmlStyle={{ fontSize: "clamp(40px, 6vw, 72px)" }}
            >
              Libretto vs Stagehand: compiled scripts vs runtime AI primitives.
            </Text>
            <Text
              as="p"
              size="lg"
              className="max-w-[720px] leading-relaxed text-muted"
            >
              Stagehand is a strong developer framework when you want to mix
              Playwright-style browser code with AI actions at runtime. Libretto
              is better when a known workflow should become a deterministic
              script your team owns, deploys, and runs without inference on
              every execution.
            </Text>
          </header>

          <Panel
            padding="lg"
            radius="md"
            className="mb-12 border-accent/20 bg-green-2/35"
          >
            <Kicker className="mb-3 text-sm text-accent">
              // SHORT VERSION --
            </Kicker>
            <ul className="space-y-3 leading-relaxed text-muted">
              <li>
                Use Stagehand when your TypeScript app needs runtime AI browser
                primitives such as act(), observe(), extract(), or agent(),
                especially if you are already leaning on Browserbase for hosted
                browser sessions.
              </li>
              <li>
                Use Libretto when a workflow is known and repeated enough that
                you want code generation, direct API-call shortcuts,
                deterministic runs, and no model call on every execution.
              </li>
              <li>
                The honest distinction: Stagehand helps you decide when to use
                AI inside the automation. Libretto helps you stop using AI at
                runtime once the workflow is understood.
              </li>
            </ul>
          </Panel>

          <ArticleSection
            kicker="// HOW IT WORKS --"
            title="Stagehand mixes code with AI browser primitives"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Stagehand, from Browserbase, describes itself as an AI browser
                automation framework. Its core idea is practical: write
                deterministic browser code when you know what should happen, and
                use natural-language AI primitives when you want the system to
                interpret the page.
              </p>
              <p>
                The important primitives are act(), observe(), extract(), and
                agent(). observe() can return candidate actions, act() can
                execute a natural-language instruction or a previously observed
                action, extract() can pull structured data with a schema, and
                agent() can handle multi-step tasks. That makes Stagehand much
                more developer-controlled than a fully autonomous browser agent.
              </p>
              <p>
                Stagehand also has a credible caching story. Repeatable actions
                can be cached and replayed to save time and tokens, while
                self-healing can bring AI back in when the site changes. That is
                useful, but it is still a runtime framework: fresh
                natural-language actions, extraction, and agent execution
                involve model inference while the automation runs.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// HOW LIBRETTO WORKS --"
            title="Libretto records the workflow, then compiles it to owned code"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto starts from a different assumption. A coding agent uses
                the CLI with a live browser to inspect pages, record actions,
                capture relevant network calls, and compile a known workflow
                into a deterministic script. The result is not a prompt plus
                runtime AI primitive; it is code.
              </p>
              <p>
                That script can combine Playwright with direct in-session API
                calls, which matters when a portal performs a slow UI sequence
                that maps to a cleaner underlying request. Once generated, the
                workflow is readable and reviewable by engineers. You debug the
                script, not a model's evolving interpretation of the page.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// CODE SHAPE --"
            title="What the difference looks like in code"
          >
            <div className="mb-7 space-y-6 leading-[1.85] text-muted">
              <p>
                The comparison is easier to see in code. In Stagehand, the
                durable program can still contain runtime natural-language
                instructions. In Libretto, the goal is for the coding agent to
                replace the discovered workflow with explicit TypeScript before
                production runs.
              </p>
            </div>
            <CodeComparison />
          </ArticleSection>

          <ArticleSection kicker="// HEAD TO HEAD --" title="Comparison table">
            <ComparisonTable />
          </ArticleSection>

          <ArticleSection
            kicker="// USE STAGEHAND WHEN --"
            title="When to use Stagehand instead"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Stagehand is a good fit when you want runtime AI to stay in the
                loop. If your product needs to interpret pages dynamically,
                extract structured data from changing layouts, or execute
                natural-language instructions inside a TypeScript application,
                Stagehand gives you useful primitives without forcing you into a
                fully autonomous agent model.
              </p>
              <p>
                It is also compelling if Browserbase is already your preferred
                browser infrastructure. Stagehand's local mode exists, but its
                hosted-browser story is naturally aligned with Browserbase
                sessions, debug URLs, regions, proxies, and related cloud
                features.
              </p>
              <p>
                The fairest version of the comparison is this: Stagehand is not
                just another unpredictable agent. Its observe-to-act and caching
                workflow gives developers more control than a pure runtime
                agent. If you still want runtime AI adaptation, that is a real
                advantage.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// USE LIBRETTO WHEN --"
            title="When Libretto is the better choice"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto is the better choice when the workflow is known,
                repeated, and production-facing. At that point, runtime
                flexibility is often less valuable than a script that behaves
                the same way on the thousandth run as it did on the tenth.
              </p>
              <p>
                That is especially true for messy portals. Libretto has been
                battle-tested on complex healthcare and legacy sites where small
                UI details, hidden API calls, and fragile state make runtime
                interpretation expensive to debug. The goal is to turn the
                portal workflow into maintainable automation code, not keep
                asking a model what to do next.
              </p>
              <p>
                If your team cares about auditability, code review,
                reproducibility, and keeping model calls out of the hot path,
                Libretto's compile-to-script model is the sharper fit.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// FAQ --" title="Short FAQ">
            <FAQList />
          </ArticleSection>

          <section className="border-t border-rule py-14">
            <Kicker className="mb-3 text-sm text-accent">
              // NEXT STEP --
            </Kicker>
            <Text
              as="h2"
              size="3xl"
              style="serif"
              className="mb-5 font-[300] leading-tight text-ink"
            >
              Turn one known browser flow into owned code.
            </Text>
            <Text
              as="p"
              size="md"
              className="mb-7 max-w-[640px] leading-relaxed text-muted"
            >
              If you already know the workflow, record it with Libretto and
              inspect the generated script before putting it in a production
              path.
            </Text>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                href="/docs/get-started/quickstart"
                data-fathom-event="Stagehand comparison docs click"
              >
                Go to docs
              </Button>
              <AppLink
                href="https://libretto.sh"
                className="text-sm text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-accent-bright"
                data-fathom-event="Stagehand comparison homepage click"
              >
                libretto.sh
              </AppLink>
            </div>
          </section>
        </article>
        <Footer />
      </main>
    </div>
  );
}
