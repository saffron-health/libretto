import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

interface Integration {
  name: string;
  logo: string;
  /** Explicit pixel dimensions — computed from native aspect ratio × target scale */
  width: number;
  height: number;
}

// Base height 20px, scaled per logo: ECW 0.8×, athena 1×, UHC 1.3×, Availity 1.4×, Azalea 1.2×
// Width derived from each logo's native aspect ratio.
const integrations: Integration[] = [
  { name: "eClinicalWorks", logo: "/logos/eclinicalworks.png", width: 133, height: 16 },  // 300×36, 0.8×
  { name: "athenahealth", logo: "/logos/athenahealth.png", width: 145, height: 20 },       // 500×69, 1.0×
  { name: "UnitedHealthcare", logo: "/logos/uhc.png", width: 82, height: 26 },             // 500×158, 1.3×
  { name: "Availity", logo: "/logos/availity.png", width: 91, height: 28 },                // 1579×487, 1.4×
  { name: "Azalea Health", logo: "/logos/azalea-health.png", width: 81, height: 24 },      // 300×89, 1.2×
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
        <div className="flex flex-col gap-14 md:flex-row md:items-center md:justify-between md:gap-16">
          {/* Text — left */}
          <div className="space-y-4 md:max-w-[440px]">
            <SectionHeading size="sm">
              Battle-tested on legacy healthcare software
            </SectionHeading>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              Libretto was built as an internal tool for automating healthcare
              portals where nothing else worked.
            </Text>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              It&apos;s built to handle shadow DOMs, iframes, bot detection, and
              unusable APIs.
            </Text>
          </div>

          {/* Integration logos — right, centered in available space */}
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col gap-8">
              {integrations.map((integration) => (
                <div key={integration.name} className="flex items-center gap-4">
                  <CheckIcon />
                  <img
                    src={integration.logo}
                    alt={integration.name}
                    width={integration.width}
                    height={integration.height}
                    className="grayscale opacity-70"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
