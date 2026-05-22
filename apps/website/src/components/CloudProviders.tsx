import classnames from "classnames";
import { useState } from "react";
import { Text } from "./Text.js";
import { Kicker } from "./Kicker.js";
import { Panel } from "./Panel.js";
import { SiteSection } from "./SiteSection.js";
import {
  AWSLogo,
  KernelLogo,
  BrowserbaseLogo,
  SteelLogo,
  GCPLogo,
  CheckIcon,
  CopyIcon,
} from "../icons";

const linkClass = "underline text-ink/70 transition-colors hover:text-ink";
const DEPLOY_COMMAND = "libretto cloud deploy";

const LOGOS = [
  <BrowserbaseLogo key="bb" className="h-5 w-auto text-ink/35" />,
  <KernelLogo key="k" className="h-4 w-auto text-ink/35" />,
  <SteelLogo key="steel" className="h-4 w-auto text-ink/35" />,
  <AWSLogo key="aws" className="h-9 w-auto text-ink/35" />,
  <GCPLogo key="gcp" className="h-8 w-auto text-ink/35" />,
];

function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Panel
      padding="none"
      radius="xl"
      tone="accent"
      className="relative px-5 py-4 pr-12 font-mono text-[13px] text-ink/80 shadow-sm"
    >
      <button
        type="button"
        onClick={handleCopy}
        className="copy-icon-btn absolute right-2.5 top-2.5 size-7 flex items-center justify-center rounded-lg"
      >
        <div className="relative size-[18px] shrink-0">
          <div
            className={classnames(
              "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out",
              copied ? "scale-100 opacity-100" : "scale-[0.25] opacity-0",
            )}
          >
            <CheckIcon width={18} height={18} />
          </div>
          <div
            className={classnames(
              "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out",
              copied ? "scale-[0.25] opacity-0" : "scale-100 opacity-100",
            )}
          >
            <CopyIcon width={18} height={18} className="translate-y-px" />
          </div>
        </div>
      </button>
      <div className="flex items-center">
        <span className="w-4 select-none text-ink/20">$</span>
        <span className="pl-2">{command}</span>
      </div>
    </Panel>
  );
}

function LogoTile({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center border-ink/8 ${className}`}
      style={{
        background:
          "repeating-linear-gradient(315deg, color-mix(in oklch, var(--color-gray-12) 3%, transparent) 0, color-mix(in oklch, var(--color-gray-12) 3%, transparent) 1px, transparent 0, transparent 50%)",
        backgroundSize: "8px 8px",
      }}
    >
      {children}
    </div>
  );
}

function OrBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center font-mono text-sm font-medium text-amber ${className}`}
    >
      OR
    </span>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="h3"
      size="2xl"
      style="serif"
      className="crt-glow mb-3 text-ink"
      htmlStyle={{
        fontWeight: 300,
        fontSize: "clamp(24px, 2.4vw, 32px)",
        lineHeight: 1.15,
      }}
    >
      {children}
    </Text>
  );
}

export function CloudProviders() {
  return (
    <SiteSection width="lg">
      <div className="mb-10 text-center">
        <Kicker>// DEPLOY --</Kicker>
      </div>

      <div className="relative grid gap-12 md:grid-cols-2 md:gap-16">
        <div className="absolute left-1/2 top-0 bottom-0 hidden -translate-x-1/2 md:flex md:flex-col md:items-center">
          <div className="h-full w-px bg-amber/25" />
          <OrBadge className="absolute top-1/2 size-10 -translate-y-1/2 rounded-full border border-amber/40 bg-bg" />
        </div>

        <div className="md:pr-6">
          <ColumnHeading>Deploy with one command</ColumnHeading>
          <Text
            as="p"
            size="md"
            className="mb-5 leading-relaxed text-muted [text-wrap:balance]"
          >
            Run your workflows on managed, headed browsers with residential
            proxies. No infrastructure to set up.
          </Text>
          <ul className="mb-6 space-y-1.5 font-mono text-sm text-ink/55">
            <li>→ Managed headed browsers, residential proxies included</li>
            <li>
              → Debugging agents that auto-fix scripts or email a full analysis
              with video
            </li>
            <li>→ No browser pool to manage</li>
          </ul>
          <CommandBox command={DEPLOY_COMMAND} />
          <a
            href="/docs/libretto-cloud-hosting/overview"
            className={`${linkClass} mt-4 inline-block font-mono text-xs`}
          >
            cloud docs →
          </a>
        </div>

        <OrBadge className="-my-4 self-center md:hidden" />

        <div className="md:pl-6">
          <ColumnHeading>Alternative providers</ColumnHeading>
          <Text
            as="p"
            size="md"
            className="mb-5 leading-relaxed text-muted [text-wrap:balance]"
          >
            Run browsers with Kernel, Browserbase, or Steel, or run workflows on
            infrastructure you control.
          </Text>
          <ul className="mb-6 space-y-1.5 font-mono text-sm text-ink/55">
            <li>→ Connect Browserbase, Kernel, or Steel with your API key</li>
            <li>
              → Or run the workflow as a container with guides for Cloud Run and
              ECS
            </li>
          </ul>
          <div className="grid grid-cols-5 border border-ink/8">
            {LOGOS.map((logo, i) => (
              <LogoTile
                key={i}
                className={`h-16 ${i < LOGOS.length - 1 ? "border-r" : ""}`}
              >
                {logo}
              </LogoTile>
            ))}
          </div>
          <a
            href="/docs/alternative-providers/overview"
            className={`${linkClass} mt-4 inline-block font-mono text-xs`}
          >
            provider setup →
          </a>
        </div>
      </div>
    </SiteSection>
  );
}
