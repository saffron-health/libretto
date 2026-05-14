import classnames from "classnames";
import { useState } from "react";
import { Text } from "./Text";
import {
  AWSLogo,
  KernelLogo,
  BrowserbaseLogo,
  GCPLogo,
  CheckIcon,
  CopyIcon,
} from "../icons";

const linkClass = "underline text-ink/70 transition-colors hover:text-ink";
const DEPLOY_COMMAND = "libretto deploy";

function DeployTerminal() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(DEPLOY_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative w-full rounded-xl border border-accent/20 bg-panel px-5 py-4 pr-12 text-left font-mono text-[13px] text-ink/80 shadow-sm">
      <button
        type="button"
        onClick={handleCopy}
        className="copy-icon-btn absolute right-2.5 top-2.5 size-7 flex items-center justify-center rounded-lg"
      >
        <div className="relative size-[18px] shrink-0">
          <div
            className={classnames(
              "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out will-change-[opacity,filter,scale]",
              copied ? "scale-100 opacity-100" : "scale-[0.25] opacity-0",
            )}
          >
            <CheckIcon width={18} height={18} />
          </div>
          <div
            className={classnames(
              "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out will-change-[opacity,filter,scale]",
              copied ? "scale-[0.25] opacity-0" : "scale-100 opacity-100",
            )}
          >
            <CopyIcon width={18} height={18} className="translate-y-px" />
          </div>
        </div>
      </button>
      <div className="flex items-center">
        <span className="w-4 select-none text-ink/20">$</span>
        <span className="pl-2">{DEPLOY_COMMAND}</span>
      </div>
    </div>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="h3"
      size="2xl"
      style="serif"
      className="crt-glow mb-3 tracking-[-0.02em] text-ink"
      htmlStyle={{ fontWeight: 300 }}
    >
      {children}
    </Text>
  );
}

export function CloudProviders() {
  return (
    <section className="section-crt px-8 py-24">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-12 text-center">
          <span className="block font-mono text-base text-amber">
            // DEPLOY --
          </span>
        </div>

        <div className="grid items-start gap-12 md:grid-cols-2 md:gap-14">
          <div className="flex flex-col">
            <ColumnHeading>Libretto Cloud</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-6 leading-relaxed text-muted [text-wrap:balance]"
            >
              Managed browsers that scale automatically, plus debugging agents
              that auto-fix scripts when sites change. Read the{" "}
              <a href="/docs/cloud" className={linkClass}>
                cloud docs
              </a>
              .
            </Text>
            <div className="mt-auto">
              <DeployTerminal />
            </div>
          </div>

          <div className="flex flex-col">
            <ColumnHeading>Bring your own cloud</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-6 leading-relaxed text-muted [text-wrap:balance]"
            >
              Self-host on your existing infrastructure — no lock in. See the{" "}
              <a
                href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
                className={linkClass}
              >
                provider setup docs
              </a>
              .
            </Text>
            <div className="mt-auto grid grid-cols-2 border border-ink/8">
              {[
                <BrowserbaseLogo
                  key="bb"
                  className="h-5 w-auto text-ink/35"
                />,
                <KernelLogo key="k" className="h-4 w-auto text-ink/35" />,
                <AWSLogo key="aws" className="h-9 w-auto text-ink/35" />,
                <GCPLogo key="gcp" className="h-8 w-auto text-ink/35" />,
              ].map((logo, i) => (
                <div
                  key={i}
                  className="flex h-24 items-center justify-center border-ink/8 [&:nth-child(odd)]:border-r [&:nth-child(-n+2)]:border-b"
                  style={{
                    background:
                      "repeating-linear-gradient(315deg, color-mix(in oklch, var(--color-gray-12) 3%, transparent) 0, color-mix(in oklch, var(--color-gray-12) 3%, transparent) 1px, transparent 0, transparent 50%)",
                    backgroundSize: "8px 8px",
                  }}
                >
                  {logo}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
