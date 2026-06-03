import { useState } from "react";
import { REPO_URL } from "../site.js";
import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";
import { Text } from "./Text.js";

type BenchmarkMetricId = "time" | "cost" | "tokens";

interface BenchmarkMetric {
  id: BenchmarkMetricId;
  label: string;
  icon: "clock" | "dollar" | "tokens";
  baselineLabel: string;
  librettoLabel: string;
  baselineValue: number;
  librettoValue: number;
  baselineDisplay: string;
  librettoDisplay: string;
}

const metrics: BenchmarkMetric[] = [
  {
    id: "time",
    label: "Time",
    icon: "clock",
    baselineLabel: "Browser Use",
    librettoLabel: "Libretto",
    baselineValue: 79.5,
    librettoValue: 16.3,
    baselineDisplay: "79.5s",
    librettoDisplay: "16.3s",
  },
  {
    id: "cost",
    label: "Cost",
    icon: "dollar",
    baselineLabel: "Browser Use",
    librettoLabel: "Libretto",
    baselineValue: 3.7419,
    librettoValue: 0,
    baselineDisplay: "$3.74",
    librettoDisplay: "$0",
  },
  {
    id: "tokens",
    label: "Tokens",
    icon: "tokens",
    baselineLabel: "Browser Use",
    librettoLabel: "Libretto",
    baselineValue: 1020823,
    librettoValue: 0,
    baselineDisplay: "1,020,823",
    librettoDisplay: "0",
  },
];

function MetricIcon({ icon }: { icon: BenchmarkMetric["icon"] }) {
  if (icon === "clock") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
        <circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.75V8l2.25 1.35" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "dollar") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
        <path d="M8 2.75v10.5M10.75 5.25C10.2 4.45 9.22 4 8.05 4 6.55 4 5.5 4.7 5.5 5.75c0 2.4 5.25 1.1 5.25 3.75 0 1.05-1.08 1.75-2.62 1.75-1.28 0-2.35-.48-2.88-1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <path d="M3.5 4.25h9M3.5 8h9M3.5 11.75h9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.5 2.75 4.25 13.25M11.75 2.75 10.5 13.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BenchmarkBar({
  label,
  value,
  display,
  max,
  tone,
}: {
  label: string;
  value: number;
  display: string;
  max: number;
  tone: "muted" | "accent";
}) {
  const width = value === 0 ? "0%" : `${Math.max(8, (value / max) * 100)}%`;
  const barClass =
    tone === "accent"
      ? "bg-accent shadow-[0_0_18px_color-mix(in_oklch,var(--color-green-9)_35%,transparent)]"
      : "bg-ink/24";
  const rowClass =
    tone === "accent"
      ? "rounded-sm border border-accent/25 bg-accent/10 p-3"
      : "rounded-sm border border-transparent p-3";

  return (
    <div className={rowClass}>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <Text
          size="xs"
          className={tone === "accent" ? "text-accent" : "text-muted"}
        >
          {label}
        </Text>
        <span className={tone === "accent" ? "font-mono text-sm text-accent" : "font-mono text-sm text-ink/60"}>
          {display}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-sm bg-black/40 ring-1 ring-ink/10">
        <div
          className={`h-full rounded-sm transition-[width] duration-500 ease-out ${barClass}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

export function Benchmarks() {
  const [activeMetricId, setActiveMetricId] = useState<BenchmarkMetricId>("time");
  const activeMetric =
    metrics.find((metric) => metric.id === activeMetricId) ?? metrics[0];
  const maxValue = Math.max(activeMetric.baselineValue, activeMetric.librettoValue);

  return (
    <SiteSection width="lg">
      <SectionIntro
        className="mb-12"
        kicker="// BENCHMARKS --"
        title="Benchmark Results"
      >
        The agent builds the workflow once. Then it runs faster, cheaper and
        more reliably.
      </SectionIntro>

      <div className="mx-auto max-w-[1000px]">
        <div className="mb-5 grid grid-cols-3 gap-2 rounded-sm border border-ink/10 bg-black/20 p-1.5">
          {metrics.map((metric) => {
            const isActive = metric.id === activeMetric.id;
            return (
              <button
                key={metric.id}
                type="button"
                aria-pressed={isActive}
                data-fathom-event={`Benchmarks ${metric.label} tab click`}
                onClick={() => setActiveMetricId(metric.id)}
                className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 text-xs uppercase tracking-[0.08em] transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  isActive
                    ? "bg-accent text-black"
                    : "text-muted hover:bg-ink/5 hover:text-ink"
                }`}
              >
                <MetricIcon icon={metric.icon} />
                <span>{metric.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative min-h-[260px] overflow-hidden border border-ink/10 bg-black/30 p-5 md:p-7">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "linear-gradient(var(--color-rule) 1px, transparent 1px), linear-gradient(90deg, var(--color-rule) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="relative z-10 flex min-h-[206px] flex-col justify-center gap-8">
            <div className="flex flex-col gap-7">
              <BenchmarkBar
                label={activeMetric.baselineLabel}
                value={activeMetric.baselineValue}
                display={activeMetric.baselineDisplay}
                max={maxValue}
                tone="muted"
              />
              <BenchmarkBar
                label={activeMetric.librettoLabel}
                value={activeMetric.librettoValue}
                display={activeMetric.librettoDisplay}
                max={maxValue}
                tone="accent"
              />
            </div>
            <Text size="xs" className="leading-relaxed text-faint">
              Average per workflow across 27 public website evals.{" "}
              <a
                href={`${REPO_URL}/blob/main/evals/public-websites.eval.ts`}
                className="text-muted underline decoration-muted underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                data-fathom-event="Benchmarks code click"
              >
                Code here
              </a>
              .
            </Text>
          </div>
        </div>
      </div>
    </SiteSection>
  );
}
