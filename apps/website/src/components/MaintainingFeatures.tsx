import { CRTMonitor } from "./CRTMonitor.js";
import { SectionIntro } from "./SectionIntro.js";
import { SiteSection } from "./SiteSection.js";

interface HelpFlag {
  flag: string;
  description: string;
}

const flags: HelpFlag[] = [
  {
    flag: "--deterministic",
    description:
      "Every failure is reproducible. No flaky AI calls in the hot path means bugs are consistent and fixable.",
  },
  {
    flag: "--agent-debug",
    description:
      "The agent reruns broken workflows with pause statements to step through failures, just like a developer would.",
  },
  {
    flag: "--read-only",
    description:
      "Restrict the agent to observation only. It can inspect the page but won't fill forms or submit data.",
  },
];

export function MaintainingFeatures() {
  return (
    <SiteSection>
      <SectionIntro
        className="mb-12"
        kicker="// MAINTAIN --"
        title="Effortless debugging"
      >
        Browser automations inevitably hit unexpected edge cases, and Libretto
        makes them easy to diagnose and fast to fix.
      </SectionIntro>

      <CRTMonitor className="mx-auto max-w-[680px]">
        <div className="relative z-10 font-mono text-base">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-ink/10 px-5 py-2.5 text-ink/30">
            <span className="size-2.5 rounded-full bg-ink/20" />
            <span className="size-2.5 rounded-full bg-ink/20" />
            <span className="size-2.5 rounded-full bg-ink/20" />
            <span className="ml-2 text-[11px] text-ink/25">libretto --help</span>
          </div>
          {/* Body */}
          <div className="px-5 py-5">
            <div className="mb-5 flex items-center gap-2">
              <span className="inline-block size-[6px] rounded-full bg-amber" />
              <span className="text-amber text-xs tracking-widest uppercase">Capabilities</span>
            </div>
            <div className="flex flex-col gap-4">
              {flags.map((f) => (
                <div key={f.flag}>
                  <div className="text-accent">{f.flag}</div>
                  <div
                    className="mt-1 leading-relaxed text-muted"
                    style={{ paddingLeft: "2ch" }}
                  >
                    {f.description}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-1 text-ink/20">
              <span>$</span>
              <span className="inline-block w-[6px] h-[14px] bg-accent/50 animate-blink" />
            </div>
          </div>
        </div>
      </CRTMonitor>
    </SiteSection>
  );
}
