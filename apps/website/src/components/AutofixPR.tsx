import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";
import { GitHubPRMock } from "./GitHubPRMock.js";

const AUTOFIX_DOCS_URL = "/docs/understand-libretto/autofix-debugging";

interface FlowStep {
  n: string;
  title: string;
  body: string;
}

const STEPS: FlowStep[] = [
  {
    n: "1",
    title: "A run fails",
    body: "Your Playwright automation throws. A selector times out, a page changed, or a login moved.",
  },
  {
    n: "2",
    title: "The agent investigates",
    body: "The Playwright debugging agent inspects the failed page with browser tools, reads its live DOM and browser state, and confirms the root cause instead of guessing.",
  },
  {
    n: "3",
    title: "A pull request appears",
    body: "It commits a minimal fix to a new branch and opens a PR on your repo, citing the evidence behind the change.",
  },
];

export function AutofixPR() {
  return (
    <SiteSection>
      <SectionIntro
        className="mb-12"
        headingClassName="mb-4 [text-wrap:balance]"
        kicker="// AUTOFIX --"
        title="When automations break, AI opens pull requests"
      >
        Libretto&apos;s autofix agent diagnoses failures against the live site
        and opens a GitHub pull request with the fix. It&apos;s free on your
        repositories, turning a broken run into a quick code review.
      </SectionIntro>

      <div className="grid gap-10 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.1fr)] md:items-center">
        <ol className="flex flex-col gap-6">
          {STEPS.map((step) => (
            <li key={step.n} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-accent/35 bg-green-9/15 font-mono text-xs text-accent-bright">
                {step.n}
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">
                  {step.title}
                </div>
                <p className="mt-1 max-w-[420px] text-sm leading-6 text-muted">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <GitHubPRMock />
      </div>

      <div className="mt-12 flex justify-center">
        <a
          href={AUTOFIX_DOCS_URL}
          className="text-sm text-accent-bright underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
          data-fathom-event="Autofix section docs click"
        >
          Playwright debugging agent →
        </a>
      </div>
    </SiteSection>
  );
}
