import { Text } from "./components/Text";
import { InstallSnippet } from "./components/InstallSnippet";
import {
  OrchestrationContainer,
  AnimationTarget,
} from "./components/AnimationOrchestration";
import { AnimatedTitle } from "./components/AnimatedTitle";
import { AsciiLogo } from "./components/AsciiLogo";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { ProductListing } from "./components/ProductListing";
import { SectionDivider } from "./components/SectionDivider.js";

function Hero() {
  return (
    <section className="relative px-8 pt-28 pb-20 md:pt-36 md:pb-28">
      <div className="relative mx-auto max-w-[720px]">
        <div
          data-animate={AnimationTarget.AsciiLogo}
          className="mb-12 flex justify-center overflow-hidden"
        >
          <AsciiLogo className="text-[5px] sm:text-[7px] md:text-[9px] text-ink/80" />
        </div>
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="mx-auto mb-6 text-center tracking-[-0.04em] text-ink [text-wrap:pretty]"
        >
          <AnimatedTitle
            style={{
              fontWeight: 300,
              fontSize: "clamp(36px, 5vw, 64px)",
              lineHeight: 1.1,
            }}
          >
            Browser automation for coding agents
          </AnimatedTitle>
        </Text>
        <Text
          as="p"
          size="lg"
          data-animate={AnimationTarget.Content}
          htmlStyle={{ opacity: 0 }}
          className="mx-auto mb-10 max-w-[480px] text-center leading-relaxed text-muted md:text-base [text-wrap:pretty]"
        >
          Open-source CLI and tools for building reliable web integrations
        </Text>
        <div
          data-animate={AnimationTarget.Content}
          style={{ opacity: 0 }}
          className="flex flex-col items-center justify-center gap-3"
        >
          <InstallSnippet />
          <div className="text-xs text-muted">
            or{" "}
            <a
              href="https://cal.com/team/libretto/demo"
              className="text-muted underline decoration-muted decoration-1 underline-offset-4 transition-colors duration-100 hover:text-ink hover:decoration-accent"
              data-fathom-event="Hero demo click"
            >
              TALK TO A DEV
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <OrchestrationContainer className="min-h-screen bg-bg text-ink">
      <Navbar animate />
      <Hero />
      <div className="relative mx-auto max-w-[1100px]">
        <SectionDivider />
        <ProductListing />
        <Footer />
      </div>
    </OrchestrationContainer>
  );
}
