import { useRef } from "react";
import {
  CanvasAsciihedron,
  useKonamiPane,
  KonamiOverlay,
} from "./components/CanvasAsciihedron";
import { Text } from "./components/Text";
import { TerminalDemo } from "./components/TerminalDemo";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  OrchestrationContainer,
  AnimationTarget,
} from "./components/AnimationOrchestration";
import { AnimatedTitle } from "./components/AnimatedTitle";
import { AsciiLogo } from "./components/AsciiLogo";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { VersionBadge } from "./components/VersionBadge";
import { FeatureRows } from "./components/FeatureRows";
import { BattleTestedBanner } from "./components/BattleTestedBanner";
import { Benchmarks } from "./components/Benchmarks";
import { MaintainingFeatures } from "./components/MaintainingFeatures";
import { CloudProviders } from "./components/CloudProviders";
import { FAQ } from "./components/FAQ";
import { CTA } from "./components/CTA";
import { SectionDivider } from "./components/SectionDivider.js";

function Hero({
  paneUnlocked,
  onClosePane,
}: {
  paneUnlocked: boolean;
  onClosePane: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-8 pt-24 pb-16"
    >
      <div
        data-animate={AnimationTarget.Icosahedron}
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 flex -translate-y-24 max-md:-translate-y-48 items-center justify-center select-none"
      >
        <CanvasAsciihedron
          className="h-[1600px] w-[1600px] min-h-[1200px] min-w-[1200px] shrink-0 max-h-[180vw] max-w-[180vw] text-ink"
          showAnnotations={false}
          objectScale={1.2}
          baseOpacity={0.11}
          paneUnlocked={paneUnlocked}
          onClosePane={onClosePane}
        />
      </div>
      <div className="relative mx-auto max-w-[1200px]">
        <div data-animate={AnimationTarget.Navbar} style={{ opacity: 0 }}>
          <VersionBadge />
        </div>
        <div
          data-animate={AnimationTarget.AsciiLogo}
          style={{ filter: "drop-shadow(0 0 12px color-mix(in oklch, var(--color-amber-bright) 50%, transparent)) drop-shadow(0 0 32px color-mix(in oklch, var(--color-amber-bright) 25%, transparent))" }}
          className="mb-10 flex justify-center overflow-hidden"
        >
          <AsciiLogo className="text-[5px] sm:text-[7px] md:text-[10px] lg:text-[13px]" />
        </div>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="crt-glow mx-auto mb-8 max-w-[720px] text-center tracking-[-0.04em] text-ink [text-wrap:balance]"
        >
          <AnimatedTitle
            className=""
            style={{
              fontWeight: 300,
              fontSize: "clamp(40px, 6vw, 80px)",
              lineHeight: 1.05,
            }}
          >
            Automate the work that happens in your browser
          </AnimatedTitle>
        </Text>
        <Text
          as="p"
          size="lg"
          data-animate={AnimationTarget.Content}
          htmlStyle={{ opacity: 0 }}
          className="mx-auto mb-8 max-w-[640px] text-center leading-relaxed md:text-base [text-wrap:balance]"
        >
          Libretto makes tools for humans and agents to automate any browser
          task: Chrome extensions, CLIs, SDKs, cloud browsers, and more.
        </Text>
        <div data-animate={AnimationTarget.Content} style={{ opacity: 0 }} className="mb-16 flex flex-col items-center justify-center gap-3">
          <InstallSnippet />
          <div className="text-xs text-muted">
            or{" "}
            <a
              href="https://cal.com/team/libretto/demo"
              className="text-muted underline decoration-muted decoration-1 underline-offset-4 transition-colors duration-100 hover:text-ink hover:decoration-accent"
              data-fathom-event="Hero demo click"
            >
              BOOK A DEMO
            </a>
          </div>
        </div>
        <div data-animate={AnimationTarget.Content} style={{ opacity: 0 }}>
          <TerminalDemo />
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { konamiProgress, konamiCompleted, paneUnlocked, closePane } =
    useKonamiPane();

  return (
    <OrchestrationContainer className="crt-page min-h-screen bg-bg text-ink">
      {!paneUnlocked && (
        <KonamiOverlay progress={konamiProgress} completed={konamiCompleted} />
      )}
      <Navbar animate />
      <Hero paneUnlocked={paneUnlocked} onClosePane={closePane} />
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
    </OrchestrationContainer>
  );
}
