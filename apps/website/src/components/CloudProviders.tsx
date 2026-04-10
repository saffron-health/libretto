import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { AWSLogo, KernelLogo, BrowserbaseLogo, GCPLogo } from "../icons";

export function CloudProviders() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[1000px] text-center">
        <SectionHeading className="mb-4">
          Cloud provider agnostic
        </SectionHeading>
        <Text
          as="p"
          size="md"
          className="mx-auto mb-14 max-w-[480px] leading-relaxed text-muted"
        >
          Works with your cloud provider. Bring your own infrastructure —
          Libretto doesn&rsquo;t lock you in.
        </Text>

        <div className="mx-auto flex max-w-[700px] flex-wrap items-center justify-center gap-12 md:gap-16">
          <KernelLogo className="h-7 w-auto text-ink/25" />
          <BrowserbaseLogo className="h-8 w-auto text-ink/25" />
          <AWSLogo className="h-8 w-auto text-ink/25" />
          <GCPLogo className="h-8 w-auto text-ink/25" />
        </div>
      </div>
    </section>
  );
}
