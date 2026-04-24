import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

interface Integration {
  name: string;
  logo: string;
  /** Explicit pixel dimensions — computed from native aspect ratio × target scale */
  width: number;
  height: number;
}

// Width derived from each logo's native aspect ratio; height tuned for visual balance.
const integrations: Integration[] = [
  { name: "athenahealth", logo: "/logos/athenahealth.png", width: 145, height: 20 },       // 500×69
  { name: "eClinicalWorks", logo: "/logos/eclinicalworks.png", width: 133, height: 16 },   // 300×36
  { name: "UnitedHealthcare", logo: "/logos/uhc.png", width: 82, height: 26 },             // 500×158
  { name: "Availity", logo: "/logos/availity.png", width: 91, height: 28 },                // 1579×487
  { name: "LinkedIn", logo: "/logos/linkedin.svg", width: 79, height: 20 },                // 568×144
  { name: "Reddit", logo: "/logos/reddit.svg", width: 69, height: 20 },                    // 515×149
  { name: "X", logo: "/logos/x.svg", width: 28, height: 26 },                              // 300×271
  { name: "eBay", logo: "/logos/ebay.svg", width: 60, height: 24 },                        // 1000×401
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
      <div className="mx-auto max-w-[1000px] rounded-2xl border border-ink/8 bg-ink/[0.03] px-6 py-14 md:px-16 md:py-20">
        <div className="flex flex-col gap-12 md:flex-row md:items-center md:justify-between md:gap-16">
          {/* Text — left */}
          <div className="space-y-4 md:max-w-[440px]">
            <SectionHeading size="sm">
              Battle-tested on the worst of the web
            </SectionHeading>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              Libretto was initially built as an internal tool for automating
              complex healthcare portals where nothing else worked.
            </Text>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              It&apos;s built to handle shadow DOMs, iframes, bot detection, and
              unusable APIs.
            </Text>
          </div>

          {/* Integration logos — 2-column grid on all breakpoints, below text on mobile */}
          <div className="flex w-full min-w-0 flex-1 items-center justify-center">
            <div className="grid w-full grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-6 md:gap-x-10 md:gap-y-6">
              {integrations.map((integration) => (
                <div key={integration.name} className="flex min-w-0 items-center gap-2 sm:gap-3 md:gap-4">
                  <CheckIcon />
                  <img
                    src={integration.logo}
                    alt={integration.name}
                    width={integration.width}
                    height={integration.height}
                    className="grayscale opacity-70 min-w-0 max-w-full h-auto"
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
