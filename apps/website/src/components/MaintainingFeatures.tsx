import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

interface MaintainFeature {
  title: string;
  description: string;
}

const features: MaintainFeature[] = [
  {
    title: "No non-determinism",
    description:
      "You're not rerunning expensive API calls, slowing down your actions, and increasing costs. Everything lives as code — when it fails, your coding agent spins up to inspect the page and resolve the fix.",
  },
  {
    title: "Make debugging easy for agents",
    description:
      "When something breaks, the agent reruns the workflow and inserts pause statements to step through and debug the failure — just like a developer would.",
  },
  {
    title: "Read-only mode for sensitive workflows",
    description:
      "Restrict the agent's access so it can only observe the page. It won't fill out incorrect information or submit something unexpected.",
  },
];

export function MaintainingFeatures() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-16 text-center">
          <SectionHeading className="mb-4">
            Maintaining automations
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto max-w-[520px] leading-relaxed text-muted"
          >
            Automations break. Libretto makes sure they&rsquo;re easy to fix.
          </Text>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-ink/8 bg-ink/[0.03] p-6"
            >
              <Text as="h3" size="md" className="mb-2 font-medium text-ink">
                {f.title}
              </Text>
              <Text as="p" size="sm" className="leading-relaxed text-muted">
                {f.description}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
