import type { ReactNode } from "react";
import { SectionHeading } from "./SectionHeading.js";
import { Text } from "./Text.js";
import { RecordReplayAnimation } from "./RecordReplayAnimation.js";
import { SecurityScanAnimation } from "./SecurityScanAnimation.js";
import { CodebaseAnimation } from "./CodebaseAnimation.js";

interface Feature {
  title: string;
  description: string;
  animation: ReactNode;
}

const features: Feature[] = [
  {
    title: "Record user actions",
    description:
      "Libretto turns your browser actions and plain-language instructions into deterministic automation scripts.",
    animation: <RecordReplayAnimation />,
  },
  {
    title: "Smart integration selection",
    description:
      "Libretto analyzes each site's security and structure to determine the right integration approach, combining browser automation with direct API requests.",
    animation: <SecurityScanAnimation />,
  },
  {
    title: "Native to your codebase",
    description:
      "Libretto generates deterministic TypeScript that follows your existing abstractions and lives alongside your application code.",
    animation: <CodebaseAnimation />,
  },
];

export function FeatureRows() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[1000px]">
        {/* Divider */}
        <div className="mx-auto mb-16 h-px w-[160px] bg-ink/10" />

        <div className="mb-20 text-center">
          <SectionHeading size="sm" className="mb-4">
            Build new automations easily
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto max-w-[520px] leading-relaxed text-muted"
          >
            Go from idea to production workflow in minutes, not days.
          </Text>
        </div>

        <div className="flex flex-col gap-24">
          {features.map((feature, i) => {
            const reversed = i % 2 !== 0;
            return (
              <div
                key={feature.title}
                className={`flex flex-col items-center gap-12 md:flex-row ${reversed ? "md:flex-row-reverse" : ""}`}
              >
                <div className="flex-1">
                  <Text as="h3" size="xl" className="mb-3 font-medium text-ink">
                    {feature.title}
                  </Text>
                  <Text as="p" size="md" className="leading-relaxed text-muted">
                    {feature.description}
                  </Text>
                </div>

                <div className="flex aspect-[4/3] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-ink/8 bg-ink/[0.03]">
                  {feature.animation}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
