import { useAnimate, stagger } from "motion/react";
import { useEffect, type PropsWithChildren } from "react";

/**
 * Central orchestrator for the hero entrance animation.
 *
 * Sequence:
 *  1. Title words appear one-by-one (staggered fade+translate)
 *  2. Description + install snippet fade in
 *  3. Navbar slides down from top
 */

/** Animation target names — use as `data-animate={AnimationTarget.xxx}` */
export const AnimationTarget = {
  AsciiLogo: "ascii-logo",
  TitleWord: "title-word",
  Content: "content",
  Navbar: "navbar",
  Icosahedron: "icosahedron",
} as const;

/**
 * Scoped container that runs the entrance animation sequence.
 * Renders a `<div>` and targets children via `data-animate` attributes.
 */
export function OrchestrationContainer({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  const [scope, animate] = useAnimate<HTMLDivElement>();

  useEffect(() => {
    if (!scope.current) return;

    let cancelled = false;

    async function run() {
      const selector = (name: string) => `[data-animate='${name}']`;

      // ── 1. Title words fade in ──
      await animate(
        selector(AnimationTarget.TitleWord),
        { opacity: [0, 1], y: [6, 0] },
        {
          duration: 0.3,
          delay: stagger(0.055, { startDelay: 0.2 }),
        },
      );
      if (cancelled) return;

      // ── 2. Content elements fade in together ──
      animate(
        selector(AnimationTarget.Content),
        { opacity: [0, 1], y: [12, 0] },
        {
          duration: 0.4,
          delay: stagger(0.1, { startDelay: 0.05 }),
          ease: "easeOut",
        },
      );

      // Navbar slides down
      animate(
        selector(AnimationTarget.Navbar),
        { opacity: [0, 1], y: [-16, 0] },
        { duration: 0.4, delay: 0.05, ease: "easeOut" },
      );
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [scope, animate]);

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
