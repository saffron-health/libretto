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
    <section className="relative overflow-hidden px-8 pt-16 pb-16 md:pt-24">
      <div className="relative mx-auto max-w-[1200px]">
        <div className="text-center">
          <Kicker className="mb-4">// LIBRETTO CLI --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            className="crt-glow mx-auto mb-6 max-w-[720px] tracking-[-0.04em] text-ink [text-wrap:pretty]"
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
            className="mx-auto mb-8 max-w-[640px] leading-relaxed text-muted [text-wrap:pretty]"
          >
            An open-source CLI that records live browser workflows and compiles
            them into fast, reusable scripts in your codebase.
          </Text>
          <div className="mb-16 flex flex-col items-center justify-center gap-3">
            <InstallSnippet />
            <div className="text-xs text-muted">
              or{" "}
              <a
                href="https://cal.com/team/libretto/demo"
                className="text-muted underline decoration-muted decoration-1 underline-offset-4 transition-colors duration-100 hover:text-ink hover:decoration-accent"
                data-fathom-event="CLI hero demo click"
              >
                TALK TO A DEV
              </a>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[960px] overflow-hidden rounded-xl border border-rule bg-panel/50 shadow-lg shadow-black/30">
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
