import { type ReactNode } from "react";
import { SectionIntro } from "./SectionIntro.js";
import { Text } from "./Text.js";
import { SiteSection } from "./SiteSection.js";
import { REPO_URL, DISCORD_URL } from "../site";

const linkClass =
  "underline text-accent hover:text-accent-bright transition-colors";

interface FAQItem {
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
        Libretto is a family of tools for automating work in a browser. The{" "}
        <a href="/chrome-extension" className={linkClass}>
          Chrome extension
        </a>{" "}
        helps people hand off everyday browser tasks without code. The developer
        tools help teams build, host, repair, and embed reliable browser
        automations. Explore the{" "}
        <a href="#products" className={linkClass}>
          product guide
        </a>{" "}
        to find the right place to start.
      </>
    ),
  },
  {
    id: "who",
    question: "Who is Libretto good for?",
    answer:
      "Libretto is for anyone whose work or product depends on a website.\n\n- Use the Chrome extension to automate one-time tasks and recurring browser work without code.\n- Use the CLI to turn known workflows into fast, reliable scripts in your codebase.\n- Use Cloud Browsers to host and schedule production automations.\n- Use PR Review Agents to repair self-hosted Playwright workflows.\n- Use the Browser Tools SDK to give an agentic application a browser.",
  },
  {
    id: "diff",
    question: "Which Libretto product should I start with?",
    answer: (
      <>
        If you do not want to write code, start with the Chrome extension. If
        you are building an automation, start with the CLI. Add Cloud Browsers
        when you want Libretto to host it, or PR Review Agents when you want to
        keep hosting it yourself. Choose the Browser Tools SDK when the browser
        is part of an agentic application rather than a fixed workflow.
      </>
    ),
  },
  {
    id: "providers",
    question: "Can I run Libretto in my own infrastructure?",
    answer: (
      <>
        Yes. Workflows produced with the CLI live in your codebase and can run
        wherever you choose. The CLI has built-in support for{" "}
        <a
          href="https://www.browserbase.com/"
          className={linkClass}
          data-fathom-event="FAQ Browserbase click"
        >
          Browserbase
        </a>{" "}
        and{" "}
        <a
          href="https://www.kernel.sh/"
          className={linkClass}
          data-fathom-event="FAQ Kernel click"
        >
          Kernel
        </a>
        , and{" "}
        <a
          href="https://steel.dev/"
          className={linkClass}
          data-fathom-event="FAQ Steel click"
        >
          Steel
        </a>{" "}
        to spin up browser sessions directly, and it can connect to any browser
        that exposes a CDP endpoint. Use Libretto Cloud Browsers when you prefer
        a managed option.
      </>
    ),
  },
  {
    id: "oss",
    question: "Is it open source?",
    answer: (
      <>
        The Libretto CLI and developer tooling are open source under the MIT
        license. You can find the code on{" "}
        <a
          href={REPO_URL}
          className={linkClass}
          data-fathom-event="FAQ github click"
        >
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
        <a
          href={DISCORD_URL}
          className={linkClass}
          data-fathom-event="FAQ discord click"
        >
          Discord
        </a>{" "}
        for quick help, open an issue on{" "}
        <a
          href={REPO_URL}
          className={linkClass}
          data-fathom-event="FAQ github click"
        >
          GitHub
        </a>
        , or read through the{" "}
        <a
          href="/docs/get-started/quickstart"
          className={linkClass}
          data-fathom-event="FAQ docs click"
        >
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
        <Text
          as="p"
          size="sm"
          className="pb-5 leading-relaxed text-muted whitespace-pre-line"
        >
          {item.answer}
        </Text>
      </div>
    </details>
  );
}

export function FAQ() {
  return (
    <SiteSection
      id="comparisons"
      innerClassName="flex flex-col gap-12 md:flex-row md:gap-16"
    >
      <div className="md:w-1/2 md:shrink-0 md:pt-5">
        <SectionIntro
          align="left"
          headingClassName="mb-0"
          kicker="// FAQ --"
          title="Frequently asked questions"
        />
      </div>
      <div className="border-t border-ink/10 md:w-1/2">
        {faqs.map((faq) => (
          <FAQAccordionItem key={faq.id} item={faq} />
        ))}
      </div>
    </SiteSection>
  );
}
