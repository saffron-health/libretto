import type { ReactNode } from "react";
import { SectionHeading } from "./SectionHeading.js";
import { Text } from "./Text.js";
import { RecordReplayAnimation } from "./RecordReplayAnimation.js";
import { SecurityScanAnimation } from "./SecurityScanAnimation.js";
import { CodebaseAnimation } from "./CodebaseAnimation.js";
import { CRTMonitor } from "./CRTMonitor.js";

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
    <section className="section-crt px-8 py-24">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-20 text-center">
          <span className="mb-3 block font-mono text-base text-amber">// BUILD --</span>
          <SectionHeading size="sm" className="mb-4">
            Build new automations easily
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto max-w-[580px] leading-relaxed text-muted [text-wrap:balance]"
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
                  <Text as="h3" size="md" className="mb-3 font-medium text-ink">
                    <span className="text-amber">{String(i + 1).padStart(2, "0")}.</span>{" "}
                    {feature.title}
                  </Text>
                  <Text as="p" size="md" className="leading-relaxed text-muted [text-wrap:balance]">
                    {feature.description}
                  </Text>
                </div>

                <CRTMonitor className="flex aspect-[4/3] w-full flex-1 items-center justify-center">
                  {feature.animation}
                </CRTMonitor>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
