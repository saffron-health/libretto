import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import { KernelLogo, BrowserbaseLogo } from "../icons";
import type { ReactNode } from "react";

interface Provider {
  name: string;
  logo: ReactNode;
}

const providers: Provider[] = [
  {
    name: "Kernel",
    logo: <KernelLogo className="h-5 w-auto text-ink" />,
  },
  {
    name: "Browserbase",
    logo: <BrowserbaseLogo className="h-6 w-auto text-ink" />,
  },
];

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
          className="mx-auto mb-12 max-w-[480px] leading-relaxed text-muted"
        >
          Works with your cloud provider. Bring your own infrastructure —
          Libretto doesn&rsquo;t lock you in.
        </Text>

        <div className="mx-auto flex max-w-[600px] flex-wrap items-center justify-center gap-6">
          {providers.map((p) => (
            <div
              key={p.name}
              className="flex h-20 w-52 items-center justify-center rounded-xl border border-ink/8 bg-ink/[0.03] px-6"
            >
              {p.logo}
            </div>
          ))}
          <div className="flex h-20 w-52 items-center justify-center rounded-xl border border-ink/8 bg-ink/[0.03] px-6">
            <Text size="sm" className="font-medium text-faint italic">
              More coming soon
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}
