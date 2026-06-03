import { ArrowRightIcon } from "../icons/index.js";
import { AppLink } from "../routing.js";
import { SectionIntro } from "./SectionIntro.js";
import { ShellCommand } from "./ShellCommand.js";
import { SiteSection } from "./SiteSection.js";
import { Text } from "./Text.js";

const BILLING_DOCS_URL = "/docs/libretto-cloud-hosting/billing";
const BILLING_COMMAND = "npx libretto cloud billing portal";

const plans = [
  {
    name: "Free",
    price: "$0",
    cadence: "per month",
    hours: "1",
    note: "Try a hosted browser session before connecting billing.",
  },
  {
    name: "Pro",
    price: "$20",
    cadence: "per month",
    hours: "80",
    note: "For solo builders and small production workflows.",
    featured: true,
  },
  {
    name: "Team",
    price: "$100",
    cadence: "per month",
    hours: "400",
    note: "Shared capacity for teams running regular cloud jobs. BAA included.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "Contact team@libretto.sh",
    note: "BAA support, custom capacity, and deployment guidance.",
  },
];

function PlanCard({ plan }: { plan: (typeof plans)[number] }) {
  return (
    <div
      className={[
        "relative flex min-h-[260px] flex-col rounded-lg border p-5",
        plan.featured
          ? "border-accent/45 bg-green-3/35 shadow-[0_0_28px_color-mix(in_oklch,var(--color-green-9)_12%,transparent)]"
          : "border-ink/10 bg-panel",
      ].join(" ")}
    >
      <Text as="h3" size="lg" className="mb-4 flex items-center justify-between gap-3 text-ink">
        <span>{plan.name}</span>
        {plan.featured ? <span className="text-accent-bright">[Popular]</span> : null}
      </Text>
      <div className="mb-5">
        <Text
          as="div"
          size="4xl"
          style="serif"
          className="text-ink"
          htmlStyle={{ fontWeight: 300, lineHeight: 1 }}
        >
          {plan.price}
        </Text>
        <Text as="div" size="xs" className="mt-2 text-muted">
          {plan.cadence}
        </Text>
      </div>
      {plan.hours ? (
        <div className="mb-4 border-t border-ink/10 pt-4">
          <div className="flex items-baseline gap-2">
            <Text as="span" size="2xl" className="font-medium text-accent-bright">
              {plan.hours}
            </Text>
            <Text as="span" size="xs" className="text-muted">
              browser {plan.hours === "1" ? "hour" : "hours"} included
            </Text>
          </div>
          <Text as="div" size="xs" className="mt-1 text-ink">
            $0.25 per browser-hour
          </Text>
        </div>
      ) : null}
      {!plan.hours ? <div className="mb-4 border-t border-ink/10 pt-4" /> : null}
      <Text as="p" size="sm" className="mt-auto leading-relaxed text-muted">
        {plan.note}
      </Text>
    </div>
  );
}

function CloudOnlyNote() {
  return (
    <>
      <Text as="p" size="sm" className="leading-relaxed text-muted [text-wrap:pretty]">
        Pricing applies to Libretto Cloud, the hosted browser platform for
        deployed workflows. The Libretto CLI is open-source and will always be
        free to use locally or with infrastructure you control.
      </Text>
    </>
  );
}

export function Pricing() {
  return (
    <SiteSection id="pricing" width="lg">
      <SectionIntro
        kicker="// PRICING --"
        title="Libretto Cloud pricing"
        copyClassName="max-w-[680px]"
      >
        Start free, then pay for managed hosted browser time when you deploy
        workflows to Libretto Cloud.
      </SectionIntro>

      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </div>

      <div className="mx-auto mt-12 grid max-w-[860px] gap-6 text-left md:grid-cols-[1fr_360px] md:items-center">
        <div className="space-y-4">
          <CloudOnlyNote />
          <Text as="p" size="sm" className="leading-relaxed text-muted [text-wrap:pretty]">
            Usage is measured by hosted browser session time at{" "}
            <span className="text-ink">$0.25 per browser-hour</span>. Manage
            plans, invoices, and payment methods from the Libretto billing
            portal.
          </Text>
        </div>
        <div className="flex flex-col items-center justify-center gap-3">
          <ShellCommand
            ariaLabel="Copy billing portal command"
            command={BILLING_COMMAND}
            fathomEvent="Pricing billing command copy"
          />
          <AppLink
            href={BILLING_DOCS_URL}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-accent underline decoration-accent/60 underline-offset-4 transition-colors hover:text-accent-bright"
            data-fathom-event="Pricing billing docs click"
          >
            Billing docs
            <ArrowRightIcon width={15} height={15} />
          </AppLink>
        </div>
      </div>
    </SiteSection>
  );
}
