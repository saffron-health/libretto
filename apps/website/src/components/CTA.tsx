import { Button } from "./Button";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

export function CTA() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[1000px] text-center">
        <SectionHeading className="mb-4">Ready to get started?</SectionHeading>
        <Text
          as="p"
          size="md"
          className="mx-auto mb-8 max-w-[440px] leading-relaxed text-muted"
        >
          Read the docs to set up Libretto and build your first integration in
          minutes.
        </Text>
        <Button href="/docs/get-started/introduction">Go to docs</Button>
      </div>
    </section>
  );
}
