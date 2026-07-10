import type { ReactNode } from "react";
import { AsciiLibretto } from "../brand";
import { Button } from "../components/Button";
import { Footer } from "../components/Footer";
import { Kicker } from "../components/Kicker";
import { Navbar } from "../components/Navbar";
import { Panel } from "../components/Panel";
import { SectionHeading } from "../components/SectionHeading";
import { Text } from "../components/Text";
import { Prism } from "../prism";

interface ComparisonRow {
  label: string;
  playwright: ReactNode;
  playwrightMark?: "positive" | "tradeoff";
  libretto: ReactNode;
  librettoMark?: "positive" | "tradeoff";
}

const comparisonRows: ComparisonRow[] = [
  {
    label: "Core model",
    playwright:
      "A mature browser automation framework plus a recorder that generates Playwright test code from browser interactions.",
    playwrightMark: "positive",
    libretto:
      "An open-source CLI for coding agents that turns website workflows into deterministic automation scripts.",
    librettoMark: "positive",
  },
  {
    label: "Generated artifact",
    playwright:
      "A Playwright test skeleton built from recorded clicks, fills, assertions, and locators; often needs cleanup before it is reliable.",
    playwrightMark: "tradeoff",
    libretto:
      "A workflow script that can combine Playwright actions with direct in-session API calls captured from the browser.",
    librettoMark: "positive",
  },
  {
    label: "Workflow understanding",
    playwright:
      "Codegen records what you do; the developer still supplies intent, data setup, cleanup, and maintainable structure.",
    playwrightMark: "tradeoff",
    libretto:
      "A coding agent inspects the site, records the workflow, and helps turn the observed path into maintained automation code.",
    librettoMark: "positive",
  },
  {
    label: "Selectors and locators",
    playwright:
      "Tries to choose resilient role, text, and test-id locators, but recorded flows can still become brittle selector soup on real apps.",
    playwrightMark: "tradeoff",
    libretto:
      "Uses Playwright locators where UI automation is right, but can avoid some UI fragility by replacing steps with API calls.",
    librettoMark: "positive",
  },
  {
    label: "Network/API shortcuts",
    playwright:
      "Playwright has excellent network and API APIs, but codegen is documented around UI actions, assertions, and locators.",
    playwrightMark: "tradeoff",
    libretto:
      "Designed to capture useful in-session requests and turn slow UI sequences into direct calls when appropriate.",
    librettoMark: "positive",
  },
  {
    label: "Debugging",
    playwright:
      "Best-in-class developer tooling: Inspector, UI Mode, Trace Viewer, action logs, screenshots, console, and network tabs.",
    playwrightMark: "positive",
    libretto:
      "Debugs generated workflow code with browser/session context, action logs, network observations, and normal Playwright failures.",
    librettoMark: "positive",
  },
  {
    label: "Runtime determinism",
    playwright:
      "Fast and deterministic when the test code, state, data, and locators are well maintained.",
    playwrightMark: "positive",
    libretto:
      "Also fast and deterministic, with the additional goal of moving known workflow work out of UI steps when possible.",
    librettoMark: "positive",
  },
  {
    label: "Maintenance burden",
    playwright:
      "Your team owns fixtures, data setup, auth, abstractions, retries, CI, and repair when generated code breaks.",
    playwrightMark: "tradeoff",
    libretto:
      "The agent-assisted CLI is built around exploring, generating, validating, and repairing reusable workflow scripts.",
    librettoMark: "positive",
  },
  {
    label: "Best fit",
    playwright:
      "Simple frontend tests and teams that want a quick starting point before hand-maintaining the Playwright code.",
    playwrightMark: "positive",
    libretto:
      "Teams building reliable browser automations, especially against portals or third-party apps without clean APIs.",
    librettoMark: "positive",
  },
];

interface FAQItem {
  question: string;
  answer: ReactNode;
}

const faqItems: FAQItem[] = [
  {
    question: "Is Libretto replacing Playwright?",
    answer:
      "No. Libretto uses Playwright where browser automation is the right layer. The difference is workflow construction: Libretto gives coding agents a CLI for discovering, recording, validating, and maintaining scripts, and it can use direct in-session API calls when the browser reveals a better path.",
  },
  {
    question: "Is Playwright codegen bad?",
    answer:
      "No. Playwright codegen is a useful recorder and locator generator, especially for simple frontend tests. The problem is using raw generated output as a reliable browser automation. Engineers usually still need to add intent, assertions, fixtures, data handling, better waits, and long-term structure.",
  },
  {
    question: "Can Libretto output normal TypeScript?",
    answer:
      "Yes. Libretto workflows are plain code that teams can read, inspect, debug, version, and deploy.",
  },
  {
    question: "Does Playwright codegen capture API calls?",
    answer:
      "Playwright itself has strong network monitoring, request mocking, and API testing APIs. But the official codegen workflow is documented as recording browser actions, assertions, and locators, not as automatically converting observed network traffic into API-level workflow steps.",
  },
  {
    question: "When should I just use Playwright directly?",
    answer:
      "Use Playwright directly when your team already knows the app, controls the environment, and wants hand-authored browser tests or scripts. Use Libretto when the hard part is building and maintaining a reliable automation against a third-party or legacy website.",
  },
];

const playwrightExample = String.raw`import { test, expect } from "@playwright/test";

test("authorization status", async ({ page }) => {
  await page.goto("https://portal.example.com/authorizations");
  await page.getByRole("textbox", { name: "Authorization ID" }).fill("A-123");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "A-123" }).click();

  await expect(page.getByText("Approved")).toBeVisible();
});`;

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
              Playwright codegen
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
                <ComparisonMark kind={row.playwrightMark} />{" "}
                <span>{row.playwright}</span>
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
      <CodeBlock code={playwrightExample} label="Playwright codegen: recorded UI test" />
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

export function PlaywrightCodegenPage() {
  return (
    <div className="crt-page flex min-h-screen flex-col bg-bg text-ink">
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
              Libretto vs Playwright codegen: workflow compiler vs browser recorder.
            </Text>
            <Text
              as="p"
              size="lg"
              className="max-w-[720px] leading-relaxed text-muted"
            >
              Playwright is the standard for fast, deterministic browser automation, and codegen is a useful way to bootstrap tests. Libretto is for teams that want a coding agent to turn a real website workflow into a maintained script, including direct API-call shortcuts when the browser reveals them.
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
                Use Playwright directly when your team wants full control over browser tests or scripts and is ready to write the reliable parts by hand.
              </li>
              <li>
                Use Playwright codegen for simple apps and straightforward frontend tests where a recorded flow is close to the final test.
              </li>
              <li>
                Use Libretto when you are building browser automations that need to keep working, especially against third-party or legacy sites where naive recorded UI steps tend to break.
              </li>
            </ul>
          </Panel>

          <ArticleSection
            kicker="// HOW IT WORKS --"
            title="Playwright codegen records browser interactions"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Playwright is a mature open-source framework for browser automation and end-to-end testing. It supports Chromium, Firefox, and WebKit, has first-class TypeScript and JavaScript support, and also provides official Python, .NET, and Java bindings.
              </p>
              <p>
                Playwright codegen opens a browser and the Playwright Inspector. As you click, type, and add assertions, it emits Playwright code. The generated locators follow Playwright's philosophy: prefer user-facing roles, text, labels, placeholders, and test IDs over brittle CSS or XPath when possible.
              </p>
              <p>
                That output is plain code, which is a major strength. But codegen is still a recorder, and recorded browser flows are often not reliable automations by themselves. It does not know the business intent of the workflow, decide which network requests are the real abstraction, or design your fixtures, auth, data setup, cleanup, and retry strategy.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// HOW LIBRETTO WORKS --"
            title="Libretto uses Playwright, but builds a workflow artifact"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto is not anti-Playwright. It uses Playwright where the browser is the right layer. The difference is that Libretto is built for browser automations, not just recorded frontend tests. It gives coding agents a purpose-built CLI for inspecting a live site, recording the workflow, observing network calls, and turning the path into a deterministic script.
              </p>
              <p>
                The generated script can keep UI actions when they are necessary and replace slow or fragile UI sequences with direct in-session API calls when the portal exposes a cleaner request. That is the core wedge: Libretto is not just recording clicks; it is trying to produce automation code that survives real-world portal behavior.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// CODE SHAPE --"
            title="What the difference looks like in code"
          >
            <div className="mb-7 space-y-6 leading-[1.85] text-muted">
              <p>
                A codegen test often mirrors the visible UI path. That can be fine for a simple frontend test, but it is a weak foundation for many operational automations. A Libretto workflow may start from the same path, then replace fragile steps with direct requests discovered during the browser session.
              </p>
            </div>
            <CodeComparison />
          </ArticleSection>

          <ArticleSection kicker="// HEAD TO HEAD --" title="Comparison table">
            <ComparisonTable />
          </ArticleSection>

          <ArticleSection
            kicker="// USE PLAYWRIGHT WHEN --"
            title="When to use Playwright codegen instead"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Use Playwright codegen when you are writing simple tests for an app your team controls and want a quick starting point. It is useful for discovering locators, recording a happy path, and producing code you can immediately edit in your repo.
              </p>
              <p>
                Use Playwright directly when you need precise control over test structure, browser contexts, cross-browser coverage, API mocking, CI sharding, and debug artifacts. Playwright's Inspector, Trace Viewer, UI Mode, network tooling, and VS Code extension are hard to beat.
              </p>
              <p>
                If the job is normal frontend testing and your engineers are comfortable rewriting the generated output into reliable tests, Playwright may be all you need.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection
            kicker="// USE LIBRETTO WHEN --"
            title="When Libretto is the better choice"
          >
            <div className="space-y-6 leading-[1.85] text-muted">
              <p>
                Libretto is the better fit when you are building browser automations, especially against a third-party portal, legacy web app, or workflow your team does not fully control. In those cases, the hard part is often not writing one Playwright locator; it is discovering the stable path, understanding the hidden requests, and keeping the workflow working over time.
              </p>
              <p>
                It is also useful when the workflow is operational rather than test-oriented. If you need to run the same portal task thousands of times, direct API-call shortcuts, typed inputs and outputs, deployment, and agent-assisted repair become more important than a recorded test skeleton.
              </p>
              <p>
                Playwright gives you the low-level power. Libretto packages that power into an agent workflow for producing and maintaining deterministic scripts.
              </p>
            </div>
          </ArticleSection>

          <ArticleSection kicker="// FAQ --" title="Short FAQ">
            <FAQList />
          </ArticleSection>

          <section className="border-t border-rule py-14">
            <Kicker className="mb-3 text-sm text-accent">// NEXT STEP --</Kicker>
            <Text as="h2" size="3xl" style="serif" className="mb-5 font-[300] leading-tight text-ink">
              Try Libretto on a workflow codegen cannot simplify.
            </Text>
            <Text as="p" size="md" className="mb-7 max-w-[640px] leading-relaxed text-muted">
              Pick a workflow with logins, fragile UI state, or hidden network calls, then record it with Libretto and inspect the generated script.
            </Text>
            <div className="flex flex-wrap items-center gap-4">
              <Button href="/docs/get-started/quickstart" data-fathom-event="Playwright codegen comparison docs click">
                Go to docs
              </Button>
              <a
                href="https://libretto.sh"
                className="text-sm text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-accent-bright"
                data-fathom-event="Playwright codegen comparison homepage click"
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
