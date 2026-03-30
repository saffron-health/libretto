import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useAnimate, stagger } from "motion/react";
import { useEffect, useCallback } from "react";

/**
 * Central orchestrator for the hero entrance animation.
 *
 * Sequence:
 *  1. Title words appear one-by-one (staggered fade+translate)
 *  2. Description, install snippet, docs button, terminal demo fade in
 *  3. Navbar slides down from top
 *  4. Icosahedron fades in + scales down from 1.15→1
 */

/** Animation target names — use as `data-animate={ANIM.xxx}` */
export const ANIM = {
  titleWord: "title-word",
  content: "content",
  navbar: "navbar",
  icosahedron: "icosahedron",
} as const;

const sel = (name: string) => `[data-animate='${name}']`;

interface OrchestrationContext {
  /** Ref callback — attach to the scoped container that holds all animated elements */
  scopeRef: (node: HTMLElement | null) => void;
}

const Ctx = createContext<OrchestrationContext>({
  scopeRef: () => {},
});

export function useOrchestration() {
  return useContext(Ctx);
}

export function OrchestrationProvider({ children }: PropsWithChildren) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const scopeRef = useCallback(
    (node: HTMLElement | null) => {
      // Forward to motion's scope ref
      (scope as React.MutableRefObject<HTMLDivElement | null>).current =
        node as HTMLDivElement | null;
    },
    [scope],
  );

  useEffect(() => {
    if (!scope.current) return;

    let cancelled = false;

    async function run() {
      // ── 1. Title: word-by-word ──
      await animate(
        sel(ANIM.titleWord),
        { opacity: [0, 1], y: [12, 0], filter: ["blur(4px)", "blur(0px)"] },
        {
          duration: 0.45,
          delay: stagger(0.08, { startDelay: 0.15 }),
        },
      );
      if (cancelled) return;

      // ── 2. Content elements fade in together ──
      animate(
        sel(ANIM.content),
        { opacity: [0, 1], y: [18, 0] },
        {
          duration: 0.45,
          delay: stagger(0.12, { startDelay: 0.05 }),
          ease: "easeOut",
        },
      );

      // Navbar slides down
      animate(
        sel(ANIM.navbar),
        { opacity: [0, 1], y: [-20, 0] },
        { duration: 0.5, delay: 0.1, ease: "easeOut" },
      );

      // Icosahedron fades in + scales down
      await animate(
        sel(ANIM.icosahedron),
        {
          opacity: [0, 0.1],
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

  const value = useMemo(() => ({ scopeRef }), [scopeRef]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
