import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";

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
    body: "Libretto reopens the live page with browser tools, inspects the real DOM, and confirms the root cause instead of guessing.",
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

        <div className="overflow-hidden rounded-xl border border-rule bg-panel/70 shadow-lg shadow-black/30">
          <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-9/20 px-2.5 py-1 text-xs font-medium text-accent-bright">
              <span className="size-1.5 rounded-full bg-accent-bright" />
              Open
            </span>
            <span className="truncate text-sm font-semibold text-ink">
              Libretto autofix for Playwright failure
            </span>
          </div>
          <div className="px-4 py-3 text-xs text-muted">
            <span className="font-mono text-accent-bright">libretto-agent</span>{" "}
            wants to merge 1 commit into{" "}
            <span className="font-mono text-ink">main</span>
          </div>
          <div className="border-t border-rule bg-bg/70 px-4 py-3">
            <div className="mb-2 font-mono text-[11px] text-muted">
              workflows/book-appointment.ts
            </div>
            <div className="overflow-hidden rounded-md border border-rule font-mono text-xs leading-5">
              <div className="bg-red-500/10 px-3 py-1 text-red-300">
                - await page.locator('input[name="username"]').fill(login);
              </div>
              <div className="bg-green-9/15 px-3 py-1 text-accent-bright">
                + await page.locator('input[name="login"]').fill(login);
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              The sign-in field is{" "}
              <span className="font-mono text-ink">name=&quot;login&quot;</span>,
              confirmed by inspecting the live page.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-12 flex justify-center">
        <a
          href={AUTOFIX_DOCS_URL}
          className="text-sm text-accent-bright underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
          data-fathom-event="Autofix section docs click"
        >
          How the autofix PR agent works →
        </a>
      </div>
    </SiteSection>
  );
}
