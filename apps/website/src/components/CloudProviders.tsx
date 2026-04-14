import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { AWSLogo, KernelLogo, BrowserbaseLogo, GCPLogo } from "../icons";

const linkClass = "underline text-ink/70 transition-colors hover:text-ink";

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
          className="mx-auto mb-14 max-w-[560px] leading-relaxed text-muted"
        >
          Libretto workflows can be hosted on your existing infrastructure - no
          lock in. See the{" "}
          <a
            href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
            className={linkClass}
          >
            docs for setting up a provider
          </a>
          .
        </Text>

        <div className="mx-auto flex max-w-[700px] flex-wrap items-center justify-center gap-12 md:gap-16">
          <BrowserbaseLogo className="h-7 w-auto text-ink/25" />
          <KernelLogo className="h-5 w-auto text-ink/25" />
          <AWSLogo className="h-7 w-auto text-ink/25" />
          <GCPLogo className="h-7 w-auto text-ink/25" />
        </div>
      </div>
    </section>
  );
}
