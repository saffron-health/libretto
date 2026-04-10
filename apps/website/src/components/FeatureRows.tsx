import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

interface Feature {
  title: string;
  description: string;
  gifPlaceholder: string;
}

const features: Feature[] = [
  {
    title: "Record user actions",
    description:
      "Watch and record real browser interactions, then replay them as deterministic automation scripts. No manual scripting needed.",
    gifPlaceholder: "Recording user actions",
  },
  {
    title: "Multiple integration approaches",
    description:
      "Choose the right strategy for every site — from full browser automation to lightweight network-level integrations depending on security requirements.",
    gifPlaceholder: "Scanning integration approaches",
  },
  {
    title: "Lives in your repo",
    description:
      "Workflows are plain TypeScript files that live alongside your application code. Version them, review them, and deploy them like everything else.",
    gifPlaceholder: "File tree with workflows",
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
            Go from idea to production workflow in minutes, not days. Libretto
            gives your agent everything it needs to inspect, record, and ship
            browser integrations.
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

                <div className="flex aspect-[4/3] w-full flex-1 items-center justify-center rounded-xl border border-ink/8 bg-ink/[0.03]">
                  <Text size="sm" className="text-faint select-none">
                    {feature.gifPlaceholder}
                  </Text>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
