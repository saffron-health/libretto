import { useRef } from "react";
import {
  CanvasAsciihedron,
  useKonamiPane,
  KonamiOverlay,
} from "./components/CanvasAsciihedron";
import { Button } from "./components/Button";
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
import { MaintainingFeatures } from "./components/MaintainingFeatures";
import { CloudProviders } from "./components/CloudProviders";
import { FAQ } from "./components/FAQ";
import { CTA } from "./components/CTA";

function SectionDivider() {
  return (
    <div
      className="h-8 w-full border-y border-ink/10"
      style={{
        background:
          "repeating-linear-gradient(315deg, oklch(0.82 0.20 145 / 0.08) 0, oklch(0.82 0.20 145 / 0.08) 1px, transparent 0, transparent 50%)",
        backgroundSize: "10px 10px",
      }}
    />
  );
}

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
          className="h-[1600px] w-[1600px] min-h-[1200px] min-w-[1200px] shrink-0 max-h-[180vw] max-w-[180vw] text-accent"
          showAnnotations={false}
          objectScale={1.2}
          baseOpacity={0.16}
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
          style={{ filter: "drop-shadow(0 0 12px oklch(0.85 0.17 80 / 0.5)) drop-shadow(0 0 32px oklch(0.85 0.17 80 / 0.25))" }}
          className="mb-10 flex justify-center overflow-hidden"
        >
          <AsciiLogo className="text-[5px] sm:text-[7px] md:text-[10px] lg:text-[13px]" />
        </div>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="crt-glow mx-auto mb-8 max-w-[1000px] text-center tracking-[-0.04em] text-ink [text-wrap:balance]"
        >
          <AnimatedTitle
            className=""
            style={{
              fontWeight: 300,
              fontSize: "clamp(40px, 6vw, 80px)",
              lineHeight: 1.05,
            }}
          >
            The AI Toolkit for Building Robust Web Integrations
          </AnimatedTitle>
        </Text>
        <Text
          as="p"
          size="lg"
          data-animate={AnimationTarget.Content}
          htmlStyle={{ opacity: 0 }}
          className="mx-auto mb-8 max-w-[580px] text-center leading-relaxed text-muted [text-wrap:balance]"
        >
          <span className="hidden md:inline">
            An agent skill and token-efficient CLI that inspects live pages,
            reverse-engineers network requests, and ships production-ready
            integration workflows.
          </span>
          <span className="md:hidden">
            An agent skill and CLI that inspects live pages and ships
            production-ready integration workflows.
          </span>
        </Text>
        <div data-animate={AnimationTarget.Content} style={{ opacity: 0 }}>
          <InstallSnippet />
        </div>
        <div
          data-animate={AnimationTarget.Content}
          style={{ opacity: 0 }}
          className="mb-16 flex flex-col items-center gap-3"
        >
          <Button href="/docs/get-started/introduction">Go to docs</Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-faint">or</span>
            <Button href="https://cal.com/team/saffron-health/libretto-demo" variant="secondary">book a demo</Button>
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
