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
    <section className="warm-section-grid border-y border-ink/8 px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto mb-20 max-w-[680px] text-center">
          <div className="mx-auto mb-10 h-10 w-10 rounded-full border border-accent-rust/25 bg-accent-rust/10 shadow-[0_0_0_10px_rgba(22,133,127,0.06)]" />
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

        <div className="flex flex-col gap-5 md:gap-6">
          {features.map((feature, i) => {
            const reversed = i % 2 !== 0;
            return (
              <div
                key={feature.title}
                className={`group flex flex-col items-stretch gap-5 overflow-hidden rounded-[14px] border border-ink/10 bg-[#f8f4eb]/88 p-4 shadow-[0_20px_80px_rgba(44,33,22,0.06)] md:flex-row md:gap-4 ${
                  reversed ? "md:flex-row-reverse" : ""
                }`}
              >
                <div className="relative flex flex-1 flex-col justify-center p-5 md:p-10">
                  <div className="mb-8 h-1.5 w-14 rounded-full bg-accent-rust" />
                  <Text
                    as="h3"
                    size="xl"
                    className="mb-4 font-medium leading-tight text-ink"
                  >
                    {feature.title}
                  </Text>
                  <Text
                    as="p"
                    size="md"
                    className="max-w-[440px] leading-relaxed text-muted"
                  >
                    {feature.description}
                  </Text>
                </div>

                <div
                  className="flex aspect-[4/3] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-ink/8 bg-[#ece7dc] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                >
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
