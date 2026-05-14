import classnames from "classnames";
import { useState } from "react";
import { Text } from "./Text";
import { SectionHeading } from "./SectionHeading";
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

// ─── Shared bits ────────────────────────────────────────────────────────────

function CommandBox({
  command,
  size = "md",
}: {
  command: string;
  size?: "sm" | "md" | "lg";
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  const sizing =
    size === "lg"
      ? "text-[15px] px-6 py-5"
      : size === "sm"
        ? "text-[12px] px-4 py-3"
        : "text-[13px] px-5 py-4";
  return (
    <div
      className={`relative rounded-xl border border-accent/20 bg-panel font-mono text-ink/80 shadow-sm pr-12 ${sizing}`}
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
    </div>
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

const LOGOS = [
  <BrowserbaseLogo key="bb" className="h-5 w-auto text-ink/35" />,
  <KernelLogo key="k" className="h-4 w-auto text-ink/35" />,
  <AWSLogo key="aws" className="h-9 w-auto text-ink/35" />,
  <GCPLogo key="gcp" className="h-8 w-auto text-ink/35" />,
];

const CLOUD_HEADING = "Deploy with one command";
const SELF_HEADING = "Self-host";
const CLOUD_BLURB =
  "Managed browsers that scale automatically. Debugging agents detect breakage and patch your scripts in place.";
const SELF_BLURB =
  "Run on your own infrastructure. Zero lock-in, full control of the browser pool.";

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
      htmlStyle={{ fontWeight: 300, fontSize: "clamp(24px, 2.4vw, 32px)", lineHeight: 1.15 }}
    >
      {children}
    </Text>
  );
}

function VariantLabel({ name, blurb }: { name: string; blurb: string }) {
  return (
    <div className="mx-auto max-w-[1100px] border-t-2 border-dashed border-amber/40 px-8 pt-6 pb-2">
      <span className="font-mono text-xs uppercase tracking-widest text-amber/80">
        {name}
      </span>
      <span className="ml-3 font-mono text-xs text-ink/40">{blurb}</span>
    </div>
  );
}

// ─── V1: Two equal cards w/ centered OR badge ───────────────────────────────

function V1() {
  return (
    <section className="section-crt px-8 py-20">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-10 text-center">
          <span className="block font-mono text-base text-amber">
            // DEPLOY --
          </span>
        </div>
        <div className="relative grid gap-6 md:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-ink/10 bg-panel/30 p-8">
            <ColumnHeading>{CLOUD_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-6 leading-relaxed text-muted [text-wrap:balance]"
            >
              {CLOUD_BLURB}
            </Text>
            <div className="mt-auto">
              <CommandBox command={DEPLOY_COMMAND} />
              <a
                href="/docs/cloud"
                className={`${linkClass} mt-4 inline-block font-mono text-xs`}
              >
                cloud docs →
              </a>
            </div>
          </div>

          <OrBadge className="absolute left-1/2 top-1/2 z-10 hidden size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber/40 bg-bg md:inline-flex" />
          <OrBadge className="my-2 self-center md:hidden" />

          <div className="flex flex-col rounded-lg border border-ink/10 bg-panel/30 p-8">
            <ColumnHeading>{SELF_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-6 leading-relaxed text-muted [text-wrap:balance]"
            >
              {SELF_BLURB}
            </Text>
            <div className="mt-auto">
              <div className="grid grid-cols-2 border border-ink/8">
                {LOGOS.map((logo, i) => (
                  <LogoTile
                    key={i}
                    className={`h-20 ${
                      i % 2 === 0 ? "border-r" : ""
                    } ${i < 2 ? "border-b" : ""}`}
                  >
                    {logo}
                  </LogoTile>
                ))}
              </div>
              <a
                href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
                className={`${linkClass} mt-4 inline-block font-mono text-xs`}
              >
                provider setup →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── V2: Stacked, equal weight, yellow OR rule ──────────────────────────────

function V2() {
  return (
    <section className="section-crt px-8 py-20">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-12 text-center">
          <span className="block font-mono text-base text-amber">
            // DEPLOY --
          </span>
        </div>

        <div className="text-center">
          <SectionHeading size="sm" className="mb-4">
            {CLOUD_HEADING}
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto mb-8 max-w-[520px] leading-relaxed text-muted [text-wrap:balance]"
          >
            {CLOUD_BLURB}
          </Text>
          <div className="mx-auto mb-3 max-w-[420px]">
            <CommandBox command={DEPLOY_COMMAND} size="lg" />
          </div>
          <a href="/docs/cloud" className={`${linkClass} font-mono text-xs`}>
            cloud docs →
          </a>
        </div>

        <div className="my-16 flex items-center gap-4">
          <div className="h-px flex-1 bg-amber/30" />
          <OrBadge className="size-10 rounded-full border border-amber/40" />
          <div className="h-px flex-1 bg-amber/30" />
        </div>

        <div className="text-center">
          <SectionHeading size="sm" className="mb-4">
            {SELF_HEADING}
          </SectionHeading>
          <Text
            as="p"
            size="md"
            className="mx-auto mb-8 max-w-[520px] leading-relaxed text-muted [text-wrap:balance]"
          >
            {SELF_BLURB}
          </Text>
          <div className="mx-auto grid max-w-[600px] grid-cols-4 border border-ink/8">
            {LOGOS.map((logo, i) => (
              <LogoTile
                key={i}
                className={`h-24 ${i < LOGOS.length - 1 ? "border-r" : ""}`}
              >
                {logo}
              </LogoTile>
            ))}
          </div>
          <a
            href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
            className={`${linkClass} mt-4 inline-block font-mono text-xs`}
          >
            provider setup →
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── V4: Minimal rows + yellow OR between ───────────────────────────────────

function V4() {
  return (
    <section className="section-crt px-8 py-20">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-12 text-center">
          <span className="block font-mono text-base text-amber">
            // DEPLOY --
          </span>
        </div>

        <div className="grid items-center gap-8 md:grid-cols-[1fr_auto] md:gap-12">
          <div>
            <ColumnHeading>{CLOUD_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="leading-relaxed text-muted [text-wrap:balance]"
            >
              {CLOUD_BLURB}{" "}
              <a href="/docs/cloud" className={linkClass}>
                Cloud docs
              </a>
              .
            </Text>
          </div>
          <div className="w-full md:w-[300px]">
            <CommandBox command={DEPLOY_COMMAND} />
          </div>
        </div>

        <div className="my-10 flex items-center gap-4">
          <div className="h-px flex-1 bg-amber/30" />
          <OrBadge className="size-10 rounded-full border border-amber/40" />
          <div className="h-px flex-1 bg-amber/30" />
        </div>

        <div className="grid items-center gap-8 md:grid-cols-[1fr_auto] md:gap-12">
          <div>
            <ColumnHeading>{SELF_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="leading-relaxed text-muted [text-wrap:balance]"
            >
              {SELF_BLURB}{" "}
              <a
                href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
                className={linkClass}
              >
                Provider setup
              </a>
              .
            </Text>
          </div>
          <div className="grid w-full grid-cols-4 border border-ink/8 md:w-[460px]">
            {LOGOS.map((logo, i) => (
              <LogoTile
                key={i}
                className={`h-20 ${i < LOGOS.length - 1 ? "border-r" : ""}`}
              >
                {logo}
              </LogoTile>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── V5: Two cards with OR rail running between them ───────────────────────

function V5() {
  return (
    <section className="section-crt px-8 py-20">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-10 text-center">
          <span className="block font-mono text-base text-amber">
            // DEPLOY --
          </span>
        </div>
        <div className="relative grid gap-12 md:grid-cols-2 md:gap-16">
          <div className="absolute left-1/2 top-0 bottom-0 hidden -translate-x-1/2 md:flex md:flex-col md:items-center">
            <div className="h-full w-px bg-amber/25" />
            <OrBadge className="absolute top-1/2 size-10 -translate-y-1/2 rounded-full border border-amber/40 bg-bg" />
          </div>

          <div className="md:pr-6">
            <ColumnHeading>{CLOUD_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-5 leading-relaxed text-muted [text-wrap:balance]"
            >
              {CLOUD_BLURB}
            </Text>
            <ul className="mb-6 space-y-1.5 font-mono text-sm text-ink/55">
              <li>→ Auto-scaling browser pool</li>
              <li>→ Self-healing scripts via debug agents</li>
              <li>→ Zero infra to provision</li>
            </ul>
            <CommandBox command={DEPLOY_COMMAND} />
            <a
              href="/docs/cloud"
              className={`${linkClass} mt-4 inline-block font-mono text-xs`}
            >
              cloud docs →
            </a>
          </div>

          <OrBadge className="-my-4 self-center md:hidden" />

          <div className="md:pl-6">
            <ColumnHeading>{SELF_HEADING}</ColumnHeading>
            <Text
              as="p"
              size="md"
              className="mb-5 leading-relaxed text-muted [text-wrap:balance]"
            >
              {SELF_BLURB}
            </Text>
            <ul className="mb-6 space-y-1.5 font-mono text-sm text-ink/55">
              <li>→ Plug in any browser provider</li>
              <li>→ Same CLI, your hardware</li>
              <li>→ Open source &amp; auditable</li>
            </ul>
            <div className="grid grid-cols-4 border border-ink/8">
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
              href="/docs/cli-reference/open-and-connect#cloud-browser-providers"
              className={`${linkClass} mt-4 inline-block font-mono text-xs`}
            >
              provider setup →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Stack ─────────────────────────────────────────────────────────────────

export function CloudProvidersVariants() {
  return (
    <>
      <VariantLabel
        name="V1"
        blurb="two equal cards, centered OR badge in the gap"
      />
      <V1 />
      <VariantLabel
        name="V2"
        blurb="stacked equal sections, yellow OR rule between"
      />
      <V2 />
      <VariantLabel
        name="V4"
        blurb="minimal rows: text left, visual right, yellow OR between"
      />
      <V4 />
      <VariantLabel
        name="V5"
        blurb="two columns with bullets, vertical OR rail through middle"
      />
      <V5 />
    </>
  );
}
