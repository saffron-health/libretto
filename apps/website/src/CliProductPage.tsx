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
import { CanvasAsciihedron } from "./components/CanvasAsciihedron";
import { HeroResourceLinks } from "./components/HeroResourceLinks";

const DEMO_VIDEO_SRC = "/demos/cli-demo.mp4";
const DEMO_VIDEO_SOURCE =
  "https://github.com/user-attachments/assets/9b9a0ab3-5133-4b20-b3be-459943349d18";

function CliHero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 md:px-8 md:pt-24 md:pb-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_64%_28%,color-mix(in_oklch,var(--color-green-9)_11%,transparent),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 flex translate-y-6 items-center justify-center select-none max-md:translate-y-0 lg:justify-end lg:pr-[4%]">
        <CanvasAsciihedron
          className="h-[1200px] w-[1200px] min-h-[900px] min-w-[900px] max-h-[160vw] max-w-[160vw] shrink-0 text-ink lg:h-[1400px] lg:w-[1400px]"
          showAnnotations={false}
          objectScale={1.15}
          baseOpacity={0.1}
        />
      </div>
      <div className="relative mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20">
        <div>
          <Kicker className="mb-5">// LIBRETTO CLI --</Kicker>
          <Text
            as="h1"
            size="5xl"
            style="serif"
            wrap="pretty"
            className="crt-glow mb-6 max-w-[620px] tracking-[-0.045em] text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(42px, 6vw, 72px)",
              lineHeight: 0.98,
            }}
          >
            Turn website workflows into reliable APIs
          </Text>
          <Text
            as="p"
            size="lg"
            wrap="pretty"
            className="mb-9 max-w-[560px] leading-relaxed text-muted"
          >
            An open-source CLI that records live browser workflows and compiles
            them into fast, reusable scripts in your codebase.
          </Text>
          <div className="flex w-fit flex-col items-center gap-3">
            <InstallSnippet />
            <HeroResourceLinks
              docsHref="/docs/get-started/quickstart"
              docsFathomEvent="CLI hero docs click"
              talkFathomEvent="CLI hero demo click"
            />
          </div>
        </div>
        <div className="w-full overflow-hidden rounded-xl border border-rule bg-panel/50 shadow-lg shadow-black/30">
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
