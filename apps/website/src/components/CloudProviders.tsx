import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { AWSLogo, KernelLogo, BrowserbaseLogo, GCPLogo } from "../icons";

const linkClass = "underline text-ink/70 transition-colors hover:text-ink";

export function CloudProviders() {
  return (
    <section className="section-crt px-8 py-24">
      <div className="mx-auto max-w-[1000px] text-center">
        <span className="mb-3 block font-mono text-base text-amber">// DEPLOY --</span>
        <SectionHeading className="mb-4">
          Bring your own cloud
        </SectionHeading>
        <Text
          as="p"
          size="md"
          className="mx-auto mb-14 max-w-[580px] leading-relaxed text-muted [text-wrap:balance]"
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

        <div className="mx-auto grid max-w-[700px] grid-cols-2 border border-ink/8 md:grid-cols-4">
          {[
            <BrowserbaseLogo key="bb" className="h-8 w-auto text-ink/35" />,
            <KernelLogo key="k" className="h-6 w-auto text-ink/35" />,
            <AWSLogo key="aws" className="h-8 w-auto text-ink/35" />,
            <GCPLogo key="gcp" className="h-8 w-auto text-ink/35" />,
          ].map((logo, i) => (
            <div
              key={i}
              className="flex h-28 items-center justify-center border-ink/8 [&:not(:last-child)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:[&:nth-child(-n+2)]:border-b"
              style={{
                background:
                  "repeating-linear-gradient(315deg, oklch(0.94 0.02 90 / 0.03) 0, oklch(0.94 0.02 90 / 0.03) 1px, transparent 0, transparent 50%)",
                backgroundSize: "8px 8px",
              }}
            >
              {logo}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
