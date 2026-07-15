import { motion } from "motion/react";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Text } from "./components/Text";
import { Kicker } from "./components/Kicker";

export function BrowserToolsPage() {
  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-8 py-24">
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-12deg,transparent,transparent_18px,color-mix(in_oklch,var(--color-amber)_7%,transparent)_18px,color-mix(in_oklch,var(--color-amber)_7%,transparent)_36px)]" />
        <div className="relative mx-auto flex max-w-[720px] flex-col items-center text-center">
          <Kicker className="mb-6">// BROWSER TOOLS SDK --</Kicker>
          <motion.div
            initial={{ rotate: -8, y: 12, opacity: 0 }}
            animate={{ rotate: -6, y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
            className="mb-10 border-[3px] border-amber bg-bg px-8 py-5 shadow-[8px_8px_0_color-mix(in_oklch,var(--color-amber)_40%,transparent)]"
          >
            <div className="font-mono text-xs tracking-[0.28em] text-amber">
              CAUTION
            </div>
            <Text
              as="p"
              size="3xl"
              style="serif"
              className="mt-1 tracking-[-0.03em] text-ink"
              htmlStyle={{ fontWeight: 400, fontSize: "clamp(28px, 5vw, 44px)" }}
            >
              Under construction
            </Text>
          </motion.div>
          <Text
            as="h1"
            size="4xl"
            style="serif"
            className="crt-glow mb-4 tracking-[-0.03em] text-ink [text-wrap:balance]"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(32px, 4.5vw, 52px)",
              lineHeight: 1.1,
            }}
          >
            Browser Tools SDK
          </Text>
          <Text
            as="p"
            size="lg"
            className="max-w-[480px] leading-relaxed text-muted [text-wrap:balance]"
          >
            Browser tools for AI agents — open, inspect, and drive real browsers
            from any agent framework. This product page is coming soon.
          </Text>
          <a
            href="https://github.com/saffron-health/libretto/tree/main/packages/browser-tools"
            className="mt-8 text-sm text-accent-bright underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
            data-fathom-event="Browser tools github click"
            target="_blank"
            rel="noopener noreferrer"
          >
            Peek at the package on GitHub →
          </a>
        </div>
      </section>
      <div className="section-rails relative mx-auto max-w-[1100px]">
        <Footer />
      </div>
    </div>
  );
}
