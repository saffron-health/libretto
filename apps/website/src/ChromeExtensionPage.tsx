import type { ReactNode } from "react";
import { Button } from "./components/Button";
import { Footer } from "./components/Footer";
import { Kicker } from "./components/Kicker";
import { Navbar } from "./components/Navbar";
import { Panel } from "./components/Panel";
import { SectionDivider } from "./components/SectionDivider";
import { Text } from "./components/Text";
import { CanvasAsciihedron } from "./components/CanvasAsciihedron";

const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/libretto/ddjagimknfjnkaefgfjpcnanflaipbmn";

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function BrowserDemo() {
  return (
    <div className="relative w-full">
      <div className="absolute -inset-10 -z-10 bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-green-9)_12%,transparent),transparent_68%)]" />
      <div className="overflow-hidden rounded-xl border border-rule bg-panel shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="flex h-11 items-center gap-3 border-b border-rule bg-panel-hi/60 px-4">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-muted/20" />
            <span className="size-2.5 rounded-full bg-muted/20" />
            <span className="size-2.5 rounded-full bg-muted/20" />
          </div>
          <div className="mx-auto flex h-7 w-[58%] items-center rounded-md border border-rule bg-bg/60 px-3 text-[10px] text-muted/60">
            app.salesforce.com
          </div>
          <div className="w-10" />
        </div>
        <div className="grid min-h-[410px] 2xl:grid-cols-[1fr_350px]">
          <div className="hidden border-r border-rule bg-[linear-gradient(135deg,var(--color-gray-2),var(--color-gray-1))] p-8 2xl:block">
            <div className="mb-8 h-5 w-32 rounded bg-muted/10" />
            <div className="grid grid-cols-3 gap-4">
              {["New leads", "Open deals", "Tasks"].map((label, index) => (
                <div
                  key={label}
                  className="rounded-lg border border-rule bg-panel/80 p-4"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted/50">
                    {label}
                  </div>
                  <div className="mt-3 font-serif text-2xl text-ink/65">
                    {[14, 8, 23][index]}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-2 rounded-lg border border-rule p-4">
              {[72, 88, 61, 78].map((width, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 border-b border-rule/70 py-3 last:border-0"
                >
                  <span className="size-6 rounded-full bg-muted/10" />
                  <span
                    className="h-2 rounded bg-muted/10"
                    style={{ width: `${width}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col bg-[#121512]">
            <div className="flex items-center justify-between border-b border-rule px-5 py-4">
              <div>
                <div className="text-sm font-medium text-ink">Libretto</div>
                <div className="mt-0.5 text-[10px] text-accent">
                  Ready to work
                </div>
              </div>
              <span className="rounded border border-accent/20 bg-green-3/30 px-2 py-1 text-[9px] uppercase tracking-wider text-accent-bright">
                Chrome
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="ml-8 rounded-lg rounded-tr-sm border border-rule bg-panel-hi p-4 text-xs leading-relaxed text-ink">
                Find the new enterprise leads from today, look up each company,
                and rank them by fit.
              </div>
              <div className="mr-5 rounded-lg rounded-tl-sm border border-accent/20 bg-green-3/25 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs text-accent-bright">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50" />
                    <span className="relative inline-flex size-2 rounded-full bg-accent" />
                  </span>
                  Working in Salesforce
                </div>
                <div className="space-y-2 text-[11px] text-muted">
                  <div className="flex items-center gap-2">
                    <span className="text-accent">✓</span> Found 14 new leads
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-accent">✓</span> Researched 14
                    companies
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber">→</span> Ranking by fit...
                  </div>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2 rounded-lg border border-rule bg-bg/70 px-3 py-3 text-[11px] text-muted/50">
                Tell Libretto what you want done...
                <span className="ml-auto grid size-6 place-items-center rounded bg-accent text-bg">
                  <ArrowIcon />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtensionPanelHeader({ status }: { status: string }) {
  return (
    <div className="flex items-center justify-between border-b border-rule bg-panel-hi/45 px-5 py-3.5">
      <div>
        <div className="text-sm font-medium text-ink">Libretto</div>
        <div className="mt-0.5 font-mono text-[9px] text-accent-bright">
          {status}
        </div>
      </div>
      <span className="rounded border border-accent/20 bg-green-3/20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-accent-bright">
        Chrome
      </span>
    </div>
  );
}

function OneOffTaskGraphic() {
  return (
    <Panel padding="none" radius="lg" className="overflow-hidden">
      <ExtensionPanelHeader status="Task complete" />
      <div className="space-y-4 bg-[#121512] p-5">
        <div className="ml-10 rounded-lg rounded-tr-sm border border-rule bg-panel-hi p-4 text-xs leading-5 text-ink">
          Find ten dentists nearby that are open Saturdays and add their
          details to a Google Sheet.
        </div>
        <div className="mr-3 rounded-lg rounded-tl-sm border border-accent/20 bg-green-3/20 p-4">
          <div className="flex items-center gap-2 text-xs text-accent-bright">
            <span className="grid size-4 place-items-center rounded-full bg-accent text-[10px] text-bg">
              ✓
            </span>
            Done — I created the sheet
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[0.84fr_1.16fr]">
            <div className="space-y-2.5 font-mono text-[10px] text-muted">
            {[
              "Searched Google Maps",
              "Checked hours and ratings",
              "Created the spreadsheet",
            ].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <span className="text-accent">✓</span>
                <span>{step}</span>
              </div>
            ))}
            </div>
            <div className="overflow-hidden rounded-md border border-rule bg-bg/55">
              <div className="flex items-end justify-between border-b border-rule px-3 py-2.5">
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                    Google Sheets
                  </div>
                  <div className="mt-1 text-[11px] text-ink">
                    Saturday dentists
                  </div>
                </div>
                <div className="font-mono text-[9px] text-muted">10 rows</div>
              </div>
              <div className="px-3 font-mono text-[9px] text-muted">
                {[
                  ["Lake Dental", "4.9", "9–2"],
                  ["Grand Avenue", "4.8", "8–1"],
                  ["Temescal Smiles", "4.7", "9–3"],
                ].map(([name, rating, hours]) => (
                  <div
                    key={name}
                    className="grid grid-cols-[1fr_28px_30px] gap-2 border-b border-rule/70 py-2 last:border-0"
                  >
                    <span className="text-ink/80">{name}</span>
                    <span>{rating}</span>
                    <span>{hours}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function WorkflowGraphic() {
  return (
    <Panel padding="none" radius="lg" className="overflow-hidden">
      <ExtensionPanelHeader status="Workflow ready" />
      <div className="space-y-4 bg-[#121512] p-5">
        <div className="ml-10 rounded-lg rounded-tr-sm border border-rule bg-panel-hi p-4 text-xs leading-5 text-ink">
          Save this task and run it every Monday at 8 AM.
        </div>
        <div className="mr-3 rounded-lg rounded-tl-sm border border-accent/20 bg-green-3/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-accent-bright">
              <span className="grid size-4 place-items-center rounded-full bg-accent text-[10px] text-bg">
                ✓
              </span>
              Weekly sales tracker saved
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-accent-bright">
              Active
            </span>
          </div>
          <div className="mt-4 rounded-md border border-rule bg-bg/55 p-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div>
                <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                  Source
                </div>
                <div className="mt-1 text-[11px] text-ink">Shopify orders</div>
              </div>
              <ArrowIcon />
              <div>
                <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                  Destination
                </div>
                <div className="mt-1 text-[11px] text-ink">Google Sheets</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-rule pt-3">
              <div>
                <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                  Schedule
                </div>
                <div className="mt-1 text-[11px] text-ink">
                  Mondays at 8:00 AM
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1" aria-label="Runs every Monday">
                {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                  <span
                    key={`${day}-${index}`}
                    className={`grid size-5 place-items-center rounded-sm font-mono text-[8px] ${
                      index === 0
                        ? "bg-accent text-bg"
                        : "border border-rule text-faint"
                    }`}
                  >
                    {day}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-rule pt-3 font-mono text-[9px] text-muted">
            <span>Last run · 128 orders</span>
            <span className="text-accent-bright">✓ Completed</span>
            <span>Previous · 116 orders</span>
            <span className="text-accent-bright">✓ Completed</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function StorySection({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-12 px-8 py-20 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20 lg:px-16 lg:py-28">
      <div>
        <Kicker className="mb-4 text-sm text-accent">{kicker}</Kicker>
        <Text
          as="h2"
          size="4xl"
          style="serif"
          className="mb-6 max-w-[430px] font-[300] leading-[1.08] tracking-[-0.035em] text-ink [text-wrap:balance]"
        >
          {title}
        </Text>
        <Text
          as="p"
          size="md"
          className="max-w-[430px] leading-relaxed text-muted"
        >
          {description}
        </Text>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Hero() {
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
          <Kicker className="mb-5">// LIBRETTO FOR CHROME --</Kicker>
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
            Automate your work in Chrome
          </Text>
          <Text
            as="p"
            size="lg"
            wrap="pretty"
            className="mb-9 max-w-[560px] leading-relaxed text-muted"
          >
            Automate a task in Chrome, then save it as a workflow you can run
            anytime or put on a schedule, even when your computer is closed.
          </Text>
          <Button
            href={CHROME_EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-fathom-event="Chrome extension hero download click"
          >
            Get the extension
          </Button>
        </div>
        <BrowserDemo />
      </div>
    </section>
  );
}

function PrivacyStrip() {
  return (
    <section className="grid gap-8 px-8 py-16 md:grid-cols-[1fr_1.4fr] md:items-start lg:px-16">
      <div>
        <Kicker className="mb-3 text-sm text-accent">
          // YOU'RE IN CONTROL --
        </Kicker>
        <Text
          as="h2"
          size="3xl"
          style="serif"
          className="font-[300] tracking-[-0.03em]"
        >
          It works when you ask it to.
        </Text>
      </div>
      <div className="grid gap-3 text-sm leading-relaxed text-muted sm:grid-cols-2">
        <div className="flex gap-2">
          <span className="text-accent">✓</span> Only records after you start it
        </div>
        <div className="flex gap-2">
          <span className="text-accent">✓</span> Credentials encrypted at rest
        </div>
        <div className="flex gap-2">
          <span className="text-accent">✓</span> No advertising or data sales
        </div>
        <div className="flex gap-2">
          <span className="text-accent">✓</span> Delete workflows whenever you
          want
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-8 py-24 text-center" id="get-started">
      <Kicker className="mb-4 text-sm text-accent">
        // WHAT DO YOU WANT DONE? --
      </Kicker>
      <Text
        as="h2"
        size="4xl"
        style="serif"
        className="mx-auto mb-6 max-w-[680px] font-[300] tracking-[-0.035em] [text-wrap:balance]"
      >
        Put your browser to work
      </Text>
      <Text
        as="p"
        size="md"
        className="mx-auto mb-9 max-w-[560px] leading-relaxed text-muted"
      >
        From a one-time task to work that happens every day, Libretto handles
        the steps for you.
      </Text>
      <Button
        href={CHROME_EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-fathom-event="Chrome extension final download click"
      >
        Get the extension
      </Button>
    </section>
  );
}

export function ChromeExtensionPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main>
        <Hero />
        <div
          id="examples"
          className="section-rails relative mx-auto max-w-[1100px]"
        >
          <SectionDivider />
          <StorySection
            kicker="// ONE-OFF TASKS --"
            title="Delegate a browser task."
            description="Describe the result you need. Libretto navigates the sites, handles the repetitive steps, and returns the finished work."
          >
            <OneOffTaskGraphic />
          </StorySection>
          <SectionDivider />
          <StorySection
            kicker="// REPEATABLE WORKFLOWS --"
            title="Automate the tasks you repeat."
            description="Save a completed task as a workflow. Run it on demand or put it on a schedule; cloud execution keeps it moving when your computer is closed."
          >
            <WorkflowGraphic />
          </StorySection>
          <SectionDivider />
          <PrivacyStrip />
          <SectionDivider />
          <FinalCta />
          <Footer />
        </div>
      </main>
    </div>
  );
}
