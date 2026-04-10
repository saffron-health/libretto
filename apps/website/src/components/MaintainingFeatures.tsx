import { Fragment, type ReactNode } from "react";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

/** Matches TEAL_OUTER in CanvasAsciihedron */
const teal = "rgba(40, 190, 160, 1)";

/** Git-merge / branching tree — represents deterministic code paths */
function MergeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      {/* Main trunk + primary branch */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m4.75 19.25 7.25-5V5"
      />
      {/* Secondary branch + arrowhead — teal accent */}
      <path
        stroke={teal}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m14 15.63 5.25 3.62"
      />
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m8.75 8.25L12 4.75l3.25 3.5"
      />
    </svg>
  );
}

/** Stacked layers with drill-down arrow — represents stepping through code */
function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      {/* Layer shapes */}
      <path
        d="M8.09615 9.5L4.75 11L9 12.9052M8.09615 9.5L4.75 8L12 4.75L19.25 8L15.9038 9.5M8.09615 9.5L12 11.25L15.9038 9.5M15.9038 9.5L19.25 11L15 12.9052"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Down arrow — teal accent */}
      <path
        d="M12 13.75V19.25M12 19.25L9.75 16.75M12 19.25L14.25 16.75"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Arrow entering a contained box — represents viewing into a restricted space */
function LogInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      {/* Box outline */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M9.75 4.75H17.25C18.3546 4.75 19.25 5.64543 19.25 6.75V17.25C19.25 18.3546 18.3546 19.25 17.25 19.25H9.75"
      />
      {/* Arrow + chevron — teal accent */}
      <path
        stroke={teal}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M9.75 8.75L13.25 12L9.75 15.25"
      />
      <path
        stroke={teal}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M13 12H4.75"
      />
    </svg>
  );
}

interface MaintainFeature {
  title: string;
  description: string;
  icon: ReactNode;
}

const features: MaintainFeature[] = [
  {
    title: "No non-determinism",
    description:
      "You're not rerunning expensive API calls, slowing down your actions, and increasing costs. Everything lives as code — when it fails, your coding agent spins up to inspect the page and resolve the fix.",
    icon: <MergeIcon className="text-ink/40" />,
  },
  {
    title: "Make debugging easy for agents",
    description:
      "When something breaks, the agent reruns the workflow and inserts pause statements to step through and debug the failure — just like a developer would.",
    icon: <LayersIcon className="text-ink/40" />,
  },
  {
    title: "Read-only mode for sensitive workflows",
    description:
      "Restrict the agent's access so it can only observe the page. It won't fill out incorrect information or submit something unexpected.",
    icon: <LogInIcon className="text-ink/40" />,
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

        <div className="grid gap-10 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {features.map((f, i) => (
            <Fragment key={f.title}>
              {i > 0 && (
                <div className="hidden md:block w-px self-stretch bg-ink/10" />
              )}
              <div className="px-2">
                <div className="mb-4">{f.icon}</div>
                <Text as="h3" size="md" className="mb-2 font-medium text-ink">
                  {f.title}
                </Text>
                <Text as="p" size="sm" className="leading-relaxed text-muted">
                  {f.description}
                </Text>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
