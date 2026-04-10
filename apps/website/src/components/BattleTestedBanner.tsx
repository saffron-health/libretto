import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

interface Integration {
  name: string;
  logo: string;
  /** Tailwind height class — varies per logo to keep visual weight balanced */
  heightClass: string;
}

const integrations: Integration[] = [
  { name: "eClinicalWorks", logo: "/logos/eclinicalworks.png", heightClass: "h-5" },
  { name: "athenahealth", logo: "/logos/athenahealth.png", heightClass: "h-8" },
  { name: "UnitedHealthcare", logo: "/logos/uhc.png", heightClass: "h-10" },
  { name: "Availity", logo: "/logos/availity.png", heightClass: "h-8" },
  { name: "Azalea Health", logo: "/logos/azalea-health.png", heightClass: "h-8" },
];

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="shrink-0"
    >
      <circle cx="9" cy="9" r="9" fill="rgba(0, 140, 120, 1)" />
      <path
        d="M5.5 9.5L7.5 11.5L12.5 6.5"
        stroke="white"
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
      <div className="mx-auto max-w-[1000px] rounded-2xl border border-ink/8 bg-ink/[0.03] px-8 py-16 md:px-16 md:py-20">
        <div className="flex flex-col gap-12 md:flex-row md:items-center md:justify-between">
          {/* Text — left */}
          <div className="md:max-w-[440px]">
            <SectionHeading size="sm" className="mb-4">
              Battle-tested on healthcare software
            </SectionHeading>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              Libretto was born out of a frustration with building browser
              integrations at Saffron Health. It&rsquo;s been hardened against
              the most complex, stateful web applications in healthcare.
            </Text>
          </div>

          {/* Integration logos — right */}
          <div className="flex flex-col gap-5">
            {integrations.map((integration) => (
              <div key={integration.name} className="flex items-center gap-3">
                <CheckIcon />
                <img
                  src={integration.logo}
                  alt={integration.name}
                  className={`${integration.heightClass} w-auto grayscale opacity-70`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
