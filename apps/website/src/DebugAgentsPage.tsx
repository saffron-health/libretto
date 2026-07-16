import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Text } from "./components/Text";
import { Kicker } from "./components/Kicker";
import { Button } from "./components/Button";
import { FAQ, type FAQItem } from "./components/FAQ";
import { GitHubPRMock } from "./components/GitHubPRMock";
import { SectionIntro } from "./components/SectionIntro";
import { SiteSection } from "./components/SiteSection";
import { SectionDivider } from "./components/SectionDivider.js";

const GET_STARTED_URL = "/signin?mode=signup&returnTo=%2Fsetup";
const TALK_TO_A_DEV_URL = "https://cal.com/team/libretto/demo";

const SECTION_POINTS = [
  {
    title: "Keep your existing Playwright scripts",
    body: "Add Libretto at the failure boundary without changing your fixtures, retries, logging, or deployment.",
  },
  {
    title: "Use any browser provider",
    body: "Run locally, in your own infrastructure, or with a hosted browser provider. The agent uses the live page you already created.",
  },
  {
    title: "Bring your own model keys",
    body: "Choose your LLM provider and keep its API key in your own environment.",
  },
  {
    title: "Free to use",
    body: "Libretto does not charge for the PR agent. Your model and browser providers may still charge for their usage.",
  },
];

const PR_AGENT_FAQS: FAQItem[] = [
  {
    id: "finish-workflow",
    question: "What happens to the workflow after a failure?",
    answer:
      "The PR agent focuses on diagnosing the failure and proposing a code fix for future runs. Your existing catch, retry, fallback, and error handling remain responsible for the current run, while the agent opens a pull request when it finds a fix.",
  },
  {
    id: "runtime",
    question: "Do I need to use the Libretto runtime?",
    answer:
      "No. Add libretto-playwright-debugger to an existing Playwright project, initialize the debugger once, and call debugFailure() from the failure path. Your current runtime, browser provider, deployment, and workflow structure stay in place.",
  },
  {
    id: "frameworks",
    question: "Does it work with Selenium or Puppeteer?",
    answer:
      "Not yet. The current package accepts a Playwright Page, so the failed automation must run through Playwright. Selenium and Puppeteer would require separate adapters.",
  },
  {
    id: "browser-provider",
    question: "Does it work with any browser or cloud browser provider?",
    answer:
      "Yes. The PR agent works with local, self-hosted, and hosted browsers as long as your automation has a live Playwright Page and keeps it open while debugFailure() runs. You do not need to use Libretto Cloud for the browser session.",
  },
  {
    id: "free",
    question: "Is the PR agent free?",
    answer:
      "Libretto does not charge for the PR agent. You bring your own model provider API key and browser infrastructure, so your model or browser provider may still charge for their usage.",
  },
  {
    id: "open-source",
    question: "Is it open source?",
    answer: (
      <>
        Yes. The Playwright debugger package is open source under the MIT
        license in the{" "}
        <a
          href="https://github.com/saffron-health/libretto/tree/main/packages/playwright-debugger"
          className="underline text-accent transition-colors hover:text-accent-bright"
          data-fathom-event="Debug agents FAQ GitHub click"
        >
          Libretto repository
        </a>
        .
      </>
    ),
  },
];

function TalkToADevLink({ fathomEvent }: { fathomEvent: string }) {
  return (
    <div className="text-xs text-muted">
      or{" "}
      <a
        href={TALK_TO_A_DEV_URL}
        className="text-muted underline decoration-muted decoration-1 underline-offset-4 transition-colors duration-100 hover:text-ink hover:decoration-accent"
        data-fathom-event={fathomEvent}
      >
        TALK TO A DEV
      </a>
    </div>
  );
}

function DebugAgentsHero() {
  return (
    <section className="relative overflow-hidden px-8 pt-16 pb-16 md:pt-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,color-mix(in_oklch,var(--color-accent)_12%,transparent),transparent_55%)]" />
      <div className="relative mx-auto max-w-[1200px] text-center">
        <Kicker className="mb-4">// PLAYWRIGHT PR AGENTS --</Kicker>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="crt-glow mx-auto mb-6 max-w-[780px] tracking-[-0.04em] text-ink [text-wrap:pretty]"
          htmlStyle={{
            fontWeight: 300,
            fontSize: "clamp(36px, 5vw, 64px)",
            lineHeight: 1.05,
          }}
        >
          Automatically fix failing Playwright scripts
        </Text>
        <Text
          as="p"
          size="lg"
          className="mx-auto mb-8 max-w-[680px] leading-relaxed text-muted [text-wrap:pretty]"
        >
          Keep the browser automations you already run. When one fails,
          Libretto investigates the live page and opens a GitHub pull request
          with a proposed code fix.
        </Text>
        <div className="mb-16 flex flex-col items-center justify-center gap-3">
          <Button
            href={GET_STARTED_URL}
            className="h-12 min-w-[240px] px-8 text-sm"
            data-fathom-event="Debug agents hero get started click"
          >
            Get started
          </Button>
          <TalkToADevLink fathomEvent="Debug agents hero talk to dev click" />
        </div>
        <GitHubPRMock className="mx-auto max-w-[900px] text-left" />
      </div>
    </section>
  );
}

function IntegrationSection() {
  return (
    <SiteSection>
      <SectionIntro
        className="mx-auto mb-14 max-w-[680px]"
        headingClassName="mb-4 [text-wrap:pretty]"
        kicker="// ONE FAILURE CALL --"
        title="Keep your scripts. Add the repair loop."
      >
        Your existing Playwright script runs normally. The PR agent starts only
        after a failure, when it can investigate what changed and propose a fix.
      </SectionIntro>

      <div className="grid gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-2">
        {SECTION_POINTS.map((point, index) => (
          <div key={point.title} className="bg-bg p-7 md:p-9">
            <span className="mb-5 block font-mono text-xs text-accent-bright">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Text
              as="h3"
              size="xl"
              style="serif"
              className="mb-3 tracking-[-0.02em] text-ink"
              htmlStyle={{ fontWeight: 400 }}
            >
              {point.title}
            </Text>
            <Text as="p" size="sm" className="leading-6 text-muted">
              {point.body}
            </Text>
          </div>
        ))}
      </div>
    </SiteSection>
  );
}

export function DebugAgentsPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <DebugAgentsHero />
      <div className="section-rails relative mx-auto max-w-[1100px]">
        <SectionDivider />
        <IntegrationSection />
        <SectionDivider />
        <FAQ
          id="pr-agent-faq"
          items={PR_AGENT_FAQS}
          title="Frequently asked questions"
        />
        <Footer />
      </div>
    </div>
  );
}
