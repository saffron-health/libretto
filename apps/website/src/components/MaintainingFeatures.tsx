import { Fragment, type ReactNode } from "react";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

/** Matches TEAL_OUTER in CanvasAsciihedron */
const teal = "rgba(40, 190, 160, 1)";

/** Dice icon — represents deterministic outcomes */
function MergeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      <rect
        x="5.25"
        y="5.25"
        width="13.5"
        height="13.5"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9.25" cy="9.25" r="1.1" fill="currentColor" />
      <circle cx="14.75" cy="9.25" r="1.1" fill={teal} />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="9.25" cy="14.75" r="1.1" fill={teal} />
      <circle cx="14.75" cy="14.75" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Clock with loop arrow — represents repeatable debugging */
function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="4.75"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 9.5V12L13.75 13.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        stroke={teal}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M7.25 7.75H4.75V5.25"
      />
      <path
        d="M4.95 8.05A8 8 0 1 1 5.1 16.6"
        stroke={teal}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Eye icon — represents safe observation without interaction */
function LogInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M3.25 12C4.9 8.95 8.12 7 12 7C15.88 7 19.1 8.95 20.75 12C19.1 15.05 15.88 17 12 17C8.12 17 4.9 15.05 3.25 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.25" stroke={teal} strokeWidth="1.5" />
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
    title: "Deterministic failures",
    description:
      "Runtime agents introduce nondeterminism that makes failures hard to reproduce. Libretto generates deterministic code, so failures are repeatable and easy to fix.",
    icon: <MergeIcon className="text-ink/40" />,
  },
  {
    title: "Agent-friendly debugging",
    description:
      "When something breaks, the agent reruns the workflow and inserts pause statements to step through and debug the failure, just like a developer would.",
    icon: <LayersIcon className="text-ink/40" />,
  },
  {
    title: "Read-only mode for sensitive workflows",
    description:
      "Enable read-only mode to restrict the agent to only observing the page. It won't fill out incorrect information or submit something unexpected.",
    icon: <LogInIcon className="text-ink/40" />,
  },
];

export function MaintainingFeatures() {
  return (
    <section className="px-8 py-24">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-16 text-center">
          <SectionHeading className="mb-4">
            Effortless debugging
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto max-w-[520px] leading-relaxed text-muted"
          >
            Browser automations inevitably hit unexpected edge cases, and
            Libretto makes them easy to diagnose and fast to fix.
          </Text>
        </div>

        <div className="grid gap-10 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {features.map((f, i) => (
            <Fragment key={f.title}>
              {i > 0 && (
                <div className="hidden w-px self-center bg-ink/10 md:block md:h-[60%]" />
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
