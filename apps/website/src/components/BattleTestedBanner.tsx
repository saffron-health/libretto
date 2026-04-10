import type { ReactNode } from "react";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";
import {
  AthenahealthLogo,
  EClinicalWorksLogo,
  UHCLogo,
  AvailityLogo,
  AzaleaHealthLogo,
} from "../icons";

interface Integration {
  name: string;
  logo: ReactNode;
}

const integrations: Integration[] = [
  {
    name: "eClinicalWorks",
    logo: <EClinicalWorksLogo className="h-4 w-auto" />,
  },
  { name: "athenahealth", logo: <AthenahealthLogo className="h-5 w-auto" /> },
  { name: "UnitedHealthcare", logo: <UHCLogo className="h-4 w-auto" /> },
  { name: "Availity", logo: <AvailityLogo className="h-4 w-auto" /> },
  { name: "Azalea Health", logo: <AzaleaHealthLogo className="h-4 w-auto" /> },
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
      <circle cx="9" cy="9" r="9" fill="oklch(0.65 0.2 145)" />
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
          {/* Integration list — left */}
          <div className="flex flex-col gap-4">
            {integrations.map((integration) => (
              <div
                key={integration.name}
                className="flex items-center gap-3 text-ink"
              >
                <CheckIcon />
                {integration.logo}
              </div>
            ))}
          </div>

          {/* Text — right */}
          <div className="text-right md:max-w-[440px]">
            <SectionHeading size="sm" className="mb-4">
              Battle-tested on EHRs
            </SectionHeading>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              Libretto was born out of a frustration with building browser
              integrations at Saffron Health. It&rsquo;s been hardened against
              the most complex, stateful web applications in healthcare.
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}
