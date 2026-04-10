import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

const integrations = [
  "eClinicalWorks",
  "Athena Health",
  "UHC",
  "Availity",
  "Azalea Health",
];

function ShieldIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      className="text-ink/20"
    >
      <path
        d="M12 2L4 5.5V11.5C4 16.19 7.4 20.56 12 22C16.6 20.56 20 16.19 20 11.5V5.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12L11 14L15 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BattleTestedBanner() {
  return (
    <section className="px-8 py-16">
      <div className="mx-auto max-w-[1000px] rounded-2xl border border-ink/8 bg-ink/[0.03] px-8 py-16 text-center md:px-16 md:py-20">
        <div className="mx-auto mb-5 flex justify-center">
          <ShieldIcon />
        </div>
        <SectionHeading size="sm" className="mb-4">
          Battle-tested on EHRs
        </SectionHeading>
        <Text
          as="p"
          size="md"
          className="mx-auto mb-10 max-w-[520px] leading-relaxed text-muted"
        >
          Libretto was born out of a frustration with building browser
          integrations at Saffron Health. It&rsquo;s been hardened against the
          most complex, stateful web applications in healthcare.
        </Text>

        {/* Integration logo wall */}
        <div className="mx-auto flex max-w-[640px] flex-wrap items-center justify-center gap-4">
          {integrations.map((name) => (
            <div
              key={name}
              className="flex h-12 items-center justify-center rounded-lg border border-ink/6 bg-cream/60 px-5"
            >
              <Text
                size="sm"
                className="font-medium text-ink/60 whitespace-nowrap"
              >
                {name}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
