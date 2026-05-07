import { Button } from "./Button";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

export function CTA() {
  return (
    <section className="warm-section-grid px-5 pb-24 pt-16 md:px-8 md:pb-28 md:pt-20">
      <div className="mx-auto grid max-w-[1120px] gap-8 rounded-[14px] border border-ink/10 bg-[#f8f4eb]/88 px-6 py-10 shadow-[0_24px_80px_rgba(44,33,22,0.06)] md:grid-cols-[1fr_auto] md:items-center md:px-10">
        <div>
          <div className="mb-6 h-1.5 w-14 rounded-full bg-accent-rust" />
          <SectionHeading className="mb-4">Ready to get started?</SectionHeading>
        <Text
          as="p"
          size="md"
          className="max-w-[520px] leading-relaxed text-muted"
        >
          Read the docs to set up Libretto and build your first integration in
          minutes.
        </Text>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <Button
            href="/docs/get-started/introduction"
            className="libretto-button--soft-accent"
          >
            Go to docs
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-faint">or</span>
            <Button
              href="https://cal.com/team/saffron-health/libretto-demo"
              variant="secondary"
            >
              book a demo
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
