import { type ReactNode } from "react";
import { SectionIntro } from "./SectionIntro.js";
import { Text } from "./Text.js";
import { SiteSection } from "./SiteSection.js";
import { REPO_URL, DISCORD_URL } from "../site";

const linkClass = "underline text-accent hover:text-accent-bright transition-colors";

export interface FAQItem {
  id: string;
  question: string;
  answer: ReactNode;
}

const faqs: FAQItem[] = [
  {
    id: "what",
    question: "What is Libretto?",
    answer: (
      <>
        Libretto is an open-source toolkit for building browser automations. It
        gives your coding agent a live browser and a CLI to inspect pages,
        capture network traffic, record user actions, and turn them into
        deterministic automation scripts. Check out the{" "}
        <a href="/docs/get-started/quickstart" className={linkClass} data-fathom-event="FAQ docs click">
          docs
        </a>{" "}
        to get started.
      </>
    ),
  },
  {
    id: "who",
    question: "Who is Libretto good for?",
    answer:
      "Libretto is best for teams that need reliable workflows against websites where the official API is missing, incomplete, read-only, too slow to access, or does not support the action they need.\n\nGood fits include teams that:\n\n- Integrate with customer portals, EHRs, payer sites, government systems, financial dashboards, CRMs, or legacy admin tools.\n- Need to automate workflows that exist in the web UI but are not exposed through an API.\n- Need repeatable scripts that are faster, cheaper, and easier to debug than runtime browser agents.\n- Already use Playwright or browser agents, but want agents to help build and repair automation instead of making decisions on every run.\n\nLibretto is probably not the right tool if the API already covers the full workflow cleanly, or if you only need a one-off scrape.",
  },
  {
    id: "diff",
    question:
      "How is Libretto different from Browser Use, Stagehand, and Playwright codegen?",
    answer: (
      <>
        Libretto generates deterministic TypeScript workflows that can use UI
        automation and direct network requests. Browser Use is a runtime agent,
        Stagehand adds AI actions on top of Playwright, and Playwright codegen is
        a recorder for simple browser tests.
        {"\n\n"}
        Read the detailed comparisons: {" "}
        <a href="/vs/browser-use" className={linkClass} data-fathom-event="FAQ Browser Use comparison click">
          Libretto vs Browser Use
        </a>
        , {" "}
        <a href="/vs/stagehand" className={linkClass} data-fathom-event="FAQ Stagehand comparison click">
          Libretto vs Stagehand
        </a>
        , and {" "}
        <a href="/vs/playwright-codegen" className={linkClass} data-fathom-event="FAQ Playwright codegen comparison click">
          Libretto vs Playwright codegen
        </a>
        .
      </>
    ),
  },
  {
    id: "providers",
    question: "What cloud providers do you support?",
    answer: (
      <>
        The CLI has built-in support for{" "}
        <a href="https://www.browserbase.com/" className={linkClass} data-fathom-event="FAQ Browserbase click">
          Browserbase
        </a>{" "}
        and{" "}
        <a href="https://www.kernel.sh/" className={linkClass} data-fathom-event="FAQ Kernel click">
          Kernel
        </a>
        , and{" "}
        <a href="https://steel.dev/" className={linkClass} data-fathom-event="FAQ Steel click">
          Steel
        </a>
        {" "}to spin up browser sessions directly. Libretto can also connect to any
        browser that exposes a CDP endpoint, so you can run scripts against any
        arbitrary browser. Since the code lives in your repo, you can deploy it
        wherever you want, like AWS or GCP.
      </>
    ),
  },
  {
    id: "oss",
    question: "Is it open source?",
    answer: (
      <>
        Yes, fully open source under the MIT license. You can find the code on{" "}
        <a href={REPO_URL} className={linkClass} data-fathom-event="FAQ github click">
          GitHub
        </a>
        .
      </>
    ),
  },
  {
    id: "help",
    question: "Where can I get help?",
    answer: (
      <>
        Jump into our{" "}
        <a href={DISCORD_URL} className={linkClass} data-fathom-event="FAQ discord click">
          Discord
        </a>{" "}
        for quick help, open an issue on{" "}
        <a href={REPO_URL} className={linkClass} data-fathom-event="FAQ github click">
          GitHub
        </a>
        , or read through the{" "}
        <a href="/docs/get-started/quickstart" className={linkClass} data-fathom-event="FAQ docs click">
          docs
        </a>
        .
      </>
    ),
  },
];

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FAQAccordionItem({ item }: { item: FAQItem }) {
  return (
    <details className="group border-b border-ink/10 [&_summary::-webkit-details-marker]:hidden">
      <summary
        className="flex w-full cursor-pointer list-none items-center justify-between py-5 text-left outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-accent/30"
        data-fathom-event={`FAQ ${item.id} toggle click`}
      >
        <Text size="md" className="font-medium text-ink">
          {item.question}
        </Text>
        <span className="ml-4 shrink-0 text-muted">
          <span className="group-open:hidden">
            <PlusIcon />
          </span>
          <span className="hidden text-accent group-open:block">
            <MinusIcon />
          </span>
        </span>
      </summary>
      <div className="overflow-hidden">
        <Text as="p" size="sm" className="pb-5 leading-relaxed text-muted whitespace-pre-line">
          {item.answer}
        </Text>
      </div>
    </details>
  );
}

interface FAQProps {
  id?: string;
  items?: FAQItem[];
  title?: ReactNode;
}

export function FAQ({
  id = "comparisons",
  items = faqs,
  title = "Frequently asked questions",
}: FAQProps = {}) {
  return (
    <SiteSection id={id} innerClassName="flex flex-col gap-12 md:flex-row md:gap-16">
      <div className="md:w-1/2 md:shrink-0 md:pt-5">
        <SectionIntro
          align="left"
          headingClassName="mb-0"
          kicker="// FAQ --"
          title={title}
        />
      </div>
      <div className="border-t border-ink/10 md:w-1/2">
        {items.map((faq) => (
          <FAQAccordionItem key={faq.id} item={faq} />
        ))}
      </div>
    </SiteSection>
  );
}
