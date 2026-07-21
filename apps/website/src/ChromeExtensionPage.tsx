import type { ReactNode } from "react";
import { Button } from "./components/Button";
import { Footer } from "./components/Footer";
import { Kicker } from "./components/Kicker";
import { Navbar } from "./components/Navbar";
import { Panel } from "./components/Panel";
import { SectionDivider } from "./components/SectionDivider";
import { Text } from "./components/Text";

interface Example {
  site: string;
  siteTone: string;
  task: string;
}

const oneTimeExamples: Example[] = [
  {
    site: "Google Maps",
    siteTone: "text-blue-300",
    task: "Find ten dentists within five miles that are open on Saturdays, then put their names, ratings, and phone numbers in a Google Sheet.",
  },
  {
    site: "Zillow",
    siteTone: "text-blue-300",
    task: "Make me a shortlist of two-bedroom apartments in Oakland under $3,500 with parking and in-unit laundry.",
  },
  {
    site: "Amazon",
    siteTone: "text-amber-bright",
    task: "Compare the five highest-rated standing desks under $400 and summarize the differences in size, warranty, and delivery time.",
  },
  {
    site: "Salesforce",
    siteTone: "text-sky-300",
    task: "Update these 32 customer accounts using the names, titles, and phone numbers in this spreadsheet.",
  },
];

const repeatableExamples: Example[] = [
  {
    site: "Shopify → Google Sheets",
    siteTone: "text-green-300",
    task: "Every Monday at 8 AM, export last week's orders and add them to the team sales tracker.",
  },
  {
    site: "Stripe → Email",
    siteTone: "text-violet-300",
    task: "Every weekday, download yesterday's payouts and email the finance team a summary.",
  },
  {
    site: "Salesforce",
    siteTone: "text-sky-300",
    task: "Check for new enterprise leads every morning and send the account owner a prioritized list.",
  },
  {
    site: "Vendor portal → Slack",
    siteTone: "text-fuchsia-300",
    task: "Check open orders twice a day and notify the operations channel whenever a delivery date changes.",
  },
];

function SparkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12 2.5c.7 5.5 4 8.8 9.5 9.5-5.5.7-8.8 4-9.5 9.5-.7-5.5-4-8.8-9.5-9.5 5.5-.7 8.8-4 9.5-9.5Z" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M7.2 18.5h10.1a4.2 4.2 0 0 0 .7-8.3A6.2 6.2 0 0 0 6.1 8.8a4.9 4.9 0 0 0 1.1 9.7Z" />
      <path d="m9.4 14.1 2.1 2 3.6-4" />
    </svg>
  );
}

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
    <div className="relative mx-auto mt-16 max-w-[980px]">
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
        <div className="grid min-h-[410px] md:grid-cols-[1fr_350px]">
          <div className="hidden border-r border-rule bg-[linear-gradient(135deg,var(--color-gray-2),var(--color-gray-1))] p-8 md:block">
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

function ExampleCard({ example, index }: { example: Example; index: number }) {
  return (
    <Panel
      padding="none"
      radius="lg"
      className="group flex min-h-[200px] flex-col overflow-hidden transition-colors hover:border-accent/30"
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <span className={`text-xs font-medium ${example.siteTone}`}>
          {example.site}
        </span>
        <span className="text-[10px] text-muted/35">0{index + 1}</span>
      </div>
      <div className="flex flex-1 items-start p-5">
        <Text as="p" size="sm" className="leading-relaxed text-ink/85">
          “{example.task}”
        </Text>
      </div>
    </Panel>
  );
}

function ExampleGrid({ examples }: { examples: Example[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {examples.map((example, index) => (
        <ExampleCard key={example.site} example={example} index={index} />
      ))}
    </div>
  );
}

function StorySection({
  number,
  kicker,
  title,
  description,
  icon,
  examples,
  children,
}: {
  number: string;
  kicker: string;
  title: string;
  description: string;
  icon: ReactNode;
  examples: Example[];
  children: ReactNode;
}) {
  return (
    <section className="grid gap-12 px-8 py-20 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20 lg:px-16 lg:py-28">
      <div>
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full border border-accent/25 bg-green-3/25 text-accent-bright">
            {icon}
          </span>
          <span className="text-xs text-muted/45">{number}</span>
        </div>
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
        {children}
      </div>
      <ExampleGrid examples={examples} />
    </section>
  );
}

function Hero() {
  return (
    <section className="overflow-hidden px-8 pb-20 pt-24">
      <div className="mx-auto max-w-[1100px] text-center">
        <Kicker className="mb-6 text-sm text-accent">
          // LIBRETTO FOR CHROME --
        </Kicker>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="crt-glow mx-auto mb-7 max-w-[880px] font-[300] leading-[1.02] tracking-[-0.045em] text-ink [text-wrap:balance]"
          htmlStyle={{ fontSize: "clamp(48px, 7.5vw, 92px)" }}
        >
          Automate your work in Chrome
        </Text>
        <Text
          as="p"
          size="lg"
          className="mx-auto mb-9 max-w-[680px] leading-relaxed text-muted [text-wrap:balance]"
        >
          Automate a task in Chrome, then save it as a workflow you can run
          anytime or put on a schedule—even when your computer is closed.
        </Text>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            href="/signin?mode=signup"
            data-fathom-event="Chrome extension hero try click"
          >
            Try Libretto
          </Button>
          <Button
            href="#examples"
            variant="secondary"
            data-fathom-event="Chrome extension examples click"
          >
            See what it can do ↓
          </Button>
        </div>
        <BrowserDemo />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Tell it", "Describe the result you want in plain English."],
    [
      "02",
      "Watch it work",
      "Libretto clicks, types, navigates, and gathers information for you.",
    ],
    [
      "03",
      "Run it again",
      "Save any useful task and run it on demand or on a schedule.",
    ],
  ];
  return (
    <section className="px-8 py-20 lg:px-16 lg:py-24">
      <Kicker className="mb-4 text-center text-sm text-accent">
        // HOW IT WORKS --
      </Kicker>
      <Text
        as="h2"
        size="4xl"
        style="serif"
        className="mx-auto mb-14 max-w-[620px] text-center font-[300] tracking-[-0.035em] [text-wrap:balance]"
      >
        From request to done
      </Text>
      <div className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-3">
        {steps.map(([number, title, body]) => (
          <div key={number} className="bg-panel p-7">
            <span className="text-[10px] text-accent">{number}</span>
            <h3 className="mb-3 mt-10 font-serif text-2xl font-[300] text-ink">
              {title}
            </h3>
            <Text as="p" size="sm" className="leading-relaxed text-muted">
              {body}
            </Text>
          </div>
        ))}
      </div>
    </section>
  );
}

function CloudCallout() {
  return (
    <div className="mt-8 flex gap-3 rounded-lg border border-accent/20 bg-green-3/20 p-4">
      <span className="mt-0.5 text-accent">
        <CloudIcon />
      </span>
      <Text as="p" size="xs" className="leading-relaxed text-muted">
        Workflows run securely in the cloud. Close your laptop and Libretto
        keeps going.
      </Text>
    </div>
  );
}

function PrivacyStrip() {
  return (
    <section className="grid gap-8 px-8 py-16 md:grid-cols-[1fr_1.4fr] md:items-center lg:px-16">
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
      <div className="mx-auto mb-7 grid size-12 place-items-center rounded-full border border-accent/25 bg-green-3/20 text-accent-bright">
        <SparkIcon />
      </div>
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
        href="/signin?mode=signup"
        data-fathom-event="Chrome extension final try click"
      >
        Try Libretto
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
            number="01 / 02"
            kicker="// GET A TASK DONE --"
            title="Ask once. Get it done."
            description="Tell the Libretto agent what you need in everyday language. It works across websites to complete the task while you focus on something else."
            icon={<SparkIcon />}
            examples={oneTimeExamples}
          >
            <div className="mt-7 flex items-center gap-2 text-xs text-accent-bright">
              Great for research, data entry, comparisons, and one-off admin
              work
            </div>
          </StorySection>
          <SectionDivider />
          <StorySection
            number="02 / 02"
            kicker="// MAKE IT A WORKFLOW --"
            title="Save it once. Run it anytime."
            description="Turn any useful task into a dependable workflow. Run it with one click or choose a schedule and let Libretto take care of it in the cloud."
            icon={<CloudIcon />}
            examples={repeatableExamples}
          >
            <CloudCallout />
          </StorySection>
          <SectionDivider />
          <HowItWorks />
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
