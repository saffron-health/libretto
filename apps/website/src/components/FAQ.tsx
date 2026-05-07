import { type ReactNode, useState } from "react";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { CrossfadeIcon } from "./CrossfadeIcon";
import { REPO_URL, DISCORD_URL } from "../site";

const linkClass = "underline text-ink/70 hover:text-ink transition-colors";

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
        Libretto is an open-source toolkit for building browser automations. It
        gives your coding agent a live browser and a CLI to inspect pages,
        capture network traffic, record user actions, and turn them into
        deterministic automation scripts. Check out the{" "}
        <a href="/docs/get-started/introduction" className={linkClass}>
          docs
        </a>{" "}
        to get started.
      </>
    ),
  },
  {
    id: "diff",
    question:
      "How is it different from existing tools like Stagehand or Browser-Use?",
    answer:
      "Libretto is a CLI and skill that gives your coding agent tools to build new automations and debug scripts that fail. Tools like Stagehand and Browser-Use use AI at runtime to handle edge cases without human involvement. They also rely entirely on UI interactions, which makes them slow, expensive, and nondeterministic. Libretto generates deterministic scripts that can use both UI automation and direct network requests. When a script breaks, you use Libretto to diagnose and fix it. You can still add AI runtime logic since it's all just TypeScript, but it's not the default.",
  },
  {
    id: "providers",
    question: "What cloud providers do you support?",
    answer: (
      <>
        The CLI has built-in support for{" "}
        <a href="https://www.browserbase.com/" className={linkClass}>
          Browserbase
        </a>{" "}
        and{" "}
        <a href="https://www.kernel.computer/" className={linkClass}>
          Kernel
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
        <a href={REPO_URL} className={linkClass}>
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
        <a href={DISCORD_URL} className={linkClass}>
          Discord
        </a>{" "}
        for quick help, open an issue on{" "}
        <a href={REPO_URL} className={linkClass}>
          GitHub
        </a>
        , or read through the{" "}
        <a href="/docs/get-started/introduction" className={linkClass}>
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
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="border-b border-ink/8">
      <button
        className="flex w-full cursor-pointer items-center justify-between py-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/20 rounded-sm"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <Text size="md" className="font-medium text-ink">
          {item.question}
        </Text>
        <span className="ml-4 shrink-0 text-muted">
          <CrossfadeIcon activeKey={isExpanded ? "minus" : "plus"}>
            {isExpanded ? <MinusIcon /> : <PlusIcon />}
          </CrossfadeIcon>
        </span>
      </button>
      {isExpanded && (
        <div className="overflow-hidden">
          <Text as="p" size="sm" className="pb-5 leading-relaxed text-muted">
            {item.answer}
          </Text>
        </div>
      )}
    </div>
  );
}

export function FAQ() {
  return (
    <section className="warm-section-grid px-5 py-16 md:px-8 md:py-20">
      <div className="mx-auto grid max-w-[1120px] gap-8 rounded-[14px] border border-ink/10 bg-[#f8f4eb]/88 p-6 shadow-[0_20px_80px_rgba(44,33,22,0.055)] md:grid-cols-[0.72fr_1fr] md:p-10">
        <div>
          <div className="mb-8 h-1.5 w-14 rounded-full bg-accent-rust" />
          <SectionHeading>
            Frequently asked questions
          </SectionHeading>
        </div>
        <div className="rounded-xl border border-ink/8 bg-cream/72 px-5 md:px-7">
          {faqs.map((faq) => (
            <FAQAccordionItem key={faq.id} item={faq} />
          ))}
        </div>
      </div>
    </section>
  );
}
