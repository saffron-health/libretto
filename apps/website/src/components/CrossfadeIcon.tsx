import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

const crossfade = { duration: 0.15, ease: "easeOut" as const };

interface CrossfadeIconProps {
  /** The currently active icon key — triggers a cross-fade when it changes. */
  activeKey: string;
  /** The icon element to render. */
  children: ReactNode;
  /** Optional className applied to the outer container. */
  className?: string;
}

/**
 * Animated icon container that cross-fades between children when `activeKey`
 * changes. Used by MobileMenu (hamburger ↔ close) and FAQ accordion
 * (plus ↔ minus).
 */
export function CrossfadeIcon({
  activeKey,
  children,
  className = "",
}: CrossfadeIconProps) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={activeKey}
          className="flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={crossfade}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
