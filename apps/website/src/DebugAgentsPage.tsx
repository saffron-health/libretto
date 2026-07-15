import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Text } from "./components/Text";
import { Kicker } from "./components/Kicker";
import { Button } from "./components/Button";
import { GitHubPRMock } from "./components/GitHubPRMock";
import { SectionIntro } from "./components/SectionIntro";
import { SiteSection } from "./components/SiteSection";
import { SectionDivider } from "./components/SectionDivider.js";

const FEATURES = [
  {
    title: "Diagnose against the live page",
    body: "The agent attaches to the failed Playwright run, inspects the real DOM and network state, and confirms the root cause instead of guessing from stack traces.",
  },
  {
    title: "Open a minimal pull request",
    body: "It lands a focused diff on a new branch with evidence in the PR body — ready for your normal review flow.",
  },
  {
    title: "Works in your existing CI",
    body: "Route failing Playwright jobs to autofix. Free on your repositories while you keep ownership of the scripts.",
  },
  {
    title: "Built on browser tools",
    body: "Debugging uses Libretto browser tools to snapshot, execute, and verify fixes against the page that actually broke.",
  },
];

function DebugAgentsHero() {
  return (
    <section className="relative overflow-hidden px-8 pt-16 pb-12 md:pt-24 md:pb-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,color-mix(in_oklch,var(--color-accent)_12%,transparent),transparent_55%)]" />
      <div className="relative mx-auto grid max-w-[1100px] items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
        <div>
          <Kicker className="mb-4">// DEBUG AGENTS --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            className="crt-glow mb-6 max-w-[560px] tracking-[-0.04em] text-ink [text-wrap:balance]"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(36px, 5vw, 64px)",
              lineHeight: 1.05,
            }}
          >
            When automations break, AI opens pull requests
          </Text>
          <Text
            as="p"
            size="lg"
            className="mb-8 max-w-[480px] leading-relaxed text-muted [text-wrap:balance]"
          >
            Libretto&apos;s Playwright debugging agent investigates failures on
            the live site and opens a GitHub PR with the fix — turning a broken
            run into a quick code review.
          </Text>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              href="/docs/understand-libretto/autofix-debugging"
              data-fathom-event="Debug agents docs click"
            >
              Read the docs
            </Button>
            <Button
              href="/signin?mode=signup"
              variant="secondary"
              data-fathom-event="Debug agents sign up click"
            >
              Set up PR agents
            </Button>
          </div>
        </div>
        <GitHubPRMock className="lg:translate-y-2" />
      </div>
    </section>
  );
}

function FeatureListing() {
  return (
    <SiteSection>
      <SectionIntro
        align="left"
        className="mb-12 max-w-[640px]"
        headingClassName="mb-4 [text-wrap:balance]"
        kicker="// FEATURES --"
        title="Failure to fix, without the guesswork"
      >
        Debug agents close the loop between a flaky selector and a reviewable
        change — in the same repos you already ship.
      </SectionIntro>
      <div className="grid gap-10 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="max-w-[420px]">
            <Text
              as="h3"
              size="xl"
              style="serif"
              className="mb-3 tracking-[-0.02em] text-ink"
              htmlStyle={{ fontWeight: 400 }}
            >
              {feature.title}
            </Text>
            <Text as="p" size="sm" className="leading-relaxed text-muted">
              {feature.body}
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
        <FeatureListing />
        <Footer />
      </div>
    </div>
  );
}
