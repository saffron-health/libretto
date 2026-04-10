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
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { VersionBadge } from "./components/VersionBadge";
import { FeatureRows } from "./components/FeatureRows";
import { BattleTestedBanner } from "./components/BattleTestedBanner";
import { MaintainingFeatures } from "./components/MaintainingFeatures";
import { CloudProviders } from "./components/CloudProviders";
import { FAQ } from "./components/FAQ";
import { CTA } from "./components/CTA";

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
          paneUnlocked={paneUnlocked}
          onClosePane={onClosePane}
        />
      </div>
      <div className="relative mx-auto max-w-[1200px]">
        <div data-animate={AnimationTarget.Navbar} style={{ opacity: 0 }}>
          <VersionBadge />
        </div>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="mx-auto mb-8 max-w-[800px] text-center tracking-[-0.03em] text-ink [text-wrap:balance]"
        >
          <AnimatedTitle
            className="grain"
            style={{
              fontWeight: 300,
              fontSize: "clamp(48px, 6vw, 72px)",
              lineHeight: 1.1,
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
          className="mx-auto mb-8 max-w-[560px] text-center leading-relaxed text-muted"
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
          className="mb-16 flex items-center justify-center gap-6"
        >
          <Button href="/docs/get-started/introduction">Go to docs</Button>
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
    <OrchestrationContainer className="min-h-screen bg-cream text-ink">
      {!paneUnlocked && (
        <KonamiOverlay progress={konamiProgress} completed={konamiCompleted} />
      )}
      <Navbar animate />
      <Hero paneUnlocked={paneUnlocked} onClosePane={closePane} />
      <FeatureRows />
      <BattleTestedBanner />
      <MaintainingFeatures />
      <CloudProviders />
      <FAQ />
      <CTA />
      <Footer />
    </OrchestrationContainer>
  );
}
