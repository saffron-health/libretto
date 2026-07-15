import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { FeatureRows } from "./components/FeatureRows";
import { BattleTestedBanner } from "./components/BattleTestedBanner";
import { Benchmarks } from "./components/Benchmarks";
import { MaintainingFeatures } from "./components/MaintainingFeatures";
import { CloudProviders } from "./components/CloudProviders";
import { FAQ } from "./components/FAQ";
import { CTA } from "./components/CTA";
import { SectionDivider } from "./components/SectionDivider.js";
import { Text } from "./components/Text";
import { InstallSnippet } from "./components/InstallSnippet";
import { Kicker } from "./components/Kicker";

const DEMO_VIDEO_SRC = "/demos/cli-demo.mp4";
const DEMO_VIDEO_SOURCE =
  "https://github.com/user-attachments/assets/9b9a0ab3-5133-4b20-b3be-459943349d18";

function CliHero() {
  return (
    <section className="relative overflow-hidden px-8 pt-16 pb-8 md:pt-24">
      <div className="mx-auto grid max-w-[1100px] items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
        <div>
          <Kicker className="mb-4">// LIBRETTO CLI --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            className="crt-glow mb-6 max-w-[560px] tracking-[-0.04em] text-ink [text-wrap:balance]"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(36px, 5vw, 64px)",
              lineHeight: 1.05,
            }}
          >
            Turn website workflows into reliable APIs
          </Text>
          <Text
            as="p"
            size="lg"
            className="mb-8 max-w-[520px] leading-relaxed text-muted [text-wrap:balance]"
          >
            An open-source CLI that records live browser workflows and compiles
            them into fast, reusable scripts in your codebase.
          </Text>
          <div className="flex flex-col items-start gap-3">
            <InstallSnippet />
            <div className="text-xs text-muted">
              or{" "}
              <a
                href="https://cal.com/team/libretto/demo"
                className="text-muted underline decoration-muted decoration-1 underline-offset-4 transition-colors duration-100 hover:text-ink hover:decoration-accent"
                data-fathom-event="CLI hero demo click"
              >
                BOOK A DEMO
              </a>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-rule bg-panel/50 shadow-lg shadow-black/30">
          <div className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-rule" />
            <span className="size-2.5 rounded-full bg-rule" />
            <span className="size-2.5 rounded-full bg-rule" />
            <span className="ml-2 font-mono text-[11px] text-muted">
              libretto demo
            </span>
          </div>
          <video
            className="aspect-video w-full bg-bg object-cover"
            controls
            playsInline
            preload="metadata"
          >
            <source src={DEMO_VIDEO_SRC} type="video/mp4" />
            <a href={DEMO_VIDEO_SOURCE}>Watch the Libretto CLI demo</a>
          </video>
        </div>
      </div>
    </section>
  );
}

export function CliProductPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <CliHero />
      <div className="section-rails relative mx-auto max-w-[1100px]">
        <SectionDivider />
        <FeatureRows />
        <SectionDivider />
        <Benchmarks />
        <SectionDivider />
        <BattleTestedBanner />
        <SectionDivider />
        <MaintainingFeatures />
        <SectionDivider />
        <CloudProviders />
        <SectionDivider />
        <FAQ />
        <SectionDivider />
        <CTA />
        <Footer />
      </div>
    </div>
  );
}
