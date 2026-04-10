import {
  Disclosure,
  DisclosureGroup,
  DisclosurePanel,
  Button,
} from "react-aria-components";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { CrossfadeIcon } from "./CrossfadeIcon";

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    id: "what",
    question: "What is Libretto?",
    answer:
      "Libretto is an open-source toolkit for building robust web integrations. It gives coding agents a live browser and a token-efficient CLI to inspect pages, capture network traffic, record user actions, and replay them as automation scripts.",
  },
  {
    id: "diff",
    question:
      "How is it different from existing tools like Stagehand or Browser-Use?",
    answer:
      "Libretto is designed for production integrations, not one-off scripts. Workflows are deterministic TypeScript that live in your repo — AI is only invoked when something breaks. This means faster execution, lower cost, and predictable behavior.",
  },
  {
    id: "providers",
    question: "What cloud providers do you support?",
    answer:
      "Libretto currently supports Kernel and Browserbase, with more providers coming soon. You can also run browsers locally for development and testing.",
  },
  {
    id: "oss",
    question: "Is it open source?",
    answer:
      "Yes. Libretto is fully open source under the MIT license. You can find the repository on GitHub.",
  },
  {
    id: "help",
    question: "Where can I get help?",
    answer:
      "Join our Discord community for support, check the GitHub Discussions forum, or read the documentation to get started.",
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
    <Disclosure id={item.id} className="border-b border-ink/8">
      {({ isExpanded }) => (
        <>
          <Button className="flex w-full cursor-pointer items-center justify-between py-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/20 rounded-sm">
            <Text size="md" className="font-medium text-ink">
              {item.question}
            </Text>
            <span className="ml-4 shrink-0 text-muted">
              <CrossfadeIcon activeKey={isExpanded ? "minus" : "plus"}>
                {isExpanded ? <MinusIcon /> : <PlusIcon />}
              </CrossfadeIcon>
            </span>
          </Button>
          <DisclosurePanel className="overflow-hidden">
            <Text as="p" size="sm" className="pb-5 leading-relaxed text-muted">
              {item.answer}
            </Text>
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}

export function FAQ() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[680px]">
        <SectionHeading className="mb-10 text-center">
          Frequently asked questions
        </SectionHeading>
        <DisclosureGroup className="border-t border-ink/8">
          {faqs.map((faq) => (
            <FAQAccordionItem key={faq.id} item={faq} />
          ))}
        </DisclosureGroup>
      </div>
    </section>
  );
}
