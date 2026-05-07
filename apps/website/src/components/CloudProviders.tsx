import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { AWSLogo, KernelLogo, BrowserbaseLogo, GCPLogo } from "../icons";

const linkClass = "underline text-ink/70 transition-colors hover:text-ink";

export function CloudProviders() {
  return (
    <section className="warm-section-grid px-5 py-16 md:px-8 md:py-20">
      <div className="mx-auto grid max-w-[1120px] gap-10 md:grid-cols-[0.78fr_1.22fr] md:items-center">
        <div>
          <SectionHeading className="mb-4">
            Cloud provider agnostic
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="max-w-[560px] leading-relaxed text-muted"
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
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:justify-self-end">
          <div className="flex h-24 min-w-0 items-center justify-center rounded-xl border border-ink/10 bg-cream/78 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:border-accent-rust/50 md:w-32 lg:w-36">
            <BrowserbaseLogo className="h-7 w-auto text-ink/36" />
          </div>
          <div className="flex h-24 min-w-0 items-center justify-center rounded-xl border border-ink/10 bg-cream/78 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:border-accent-rust/50 md:w-32 lg:w-36">
            <KernelLogo className="h-5 w-auto text-ink/36" />
          </div>
          <div className="flex h-24 min-w-0 items-center justify-center rounded-xl border border-ink/10 bg-cream/78 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:border-accent-rust/50 md:w-32 lg:w-36">
            <AWSLogo className="h-7 w-auto text-ink/36" />
          </div>
          <div className="flex h-24 min-w-0 items-center justify-center rounded-xl border border-ink/10 bg-cream/78 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:border-accent-rust/50 md:w-32 lg:w-36">
            <GCPLogo className="h-7 w-auto text-ink/36" />
          </div>
        </div>
      </div>
    </section>
  );
}
