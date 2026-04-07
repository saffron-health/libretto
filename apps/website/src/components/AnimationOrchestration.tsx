import { useAnimate, stagger } from "motion/react";
import { useEffect, type PropsWithChildren } from "react";

/**
 * Central orchestrator for the hero entrance animation.
 *
 * Sequence:
 *  1. Title words appear one-by-one (staggered fade+translate)
 *  2. Description, install snippet, docs button, terminal demo fade in
 *  3. Navbar slides down from top
 *  4. Icosahedron fades in + scales down from 1.15→1
 */

/** Animation target names — use as `data-animate={AnimationTarget.xxx}` */
export const AnimationTarget = {
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

      // ── 1. Title: word-by-word ──
      await animate(
        selector(AnimationTarget.TitleWord),
        { opacity: [0, 1], y: [12, 0], filter: ["blur(4px)", "blur(0px)"] },
        {
          duration: 0.45,
          delay: stagger(0.08, { startDelay: 0.15 }),
        },
      );
      if (cancelled) return;

      // ── 2. Content elements fade in together ──
      animate(
        selector(AnimationTarget.Content),
        { opacity: [0, 1], y: [18, 0] },
        {
          duration: 0.45,
          delay: stagger(0.12, { startDelay: 0.05 }),
          ease: "easeOut",
        },
      );

      // Navbar slides down
      animate(
        selector(AnimationTarget.Navbar),
        { opacity: [0, 1], y: [-20, 0] },
        { duration: 0.5, delay: 0.1, ease: "easeOut" },
      );

      // Icosahedron fades in + scales down
      await animate(
        selector(AnimationTarget.Icosahedron),
        {
          opacity: [0, 1],
          scale: [1.15, 1],
          filter: ["blur(4px)", "blur(0px)"],
        },
        { duration: 1.2, delay: 0.15 },
      );
      if (cancelled) return;
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
