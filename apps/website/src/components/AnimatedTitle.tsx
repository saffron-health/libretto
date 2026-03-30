import type { CSSProperties } from "react";
import { AnimationTarget } from "./AnimationOrchestration";

/**
 * Splits children text into individual words, each wrapped with
 * `data-animate="title-word"` for the orchestrator to target.
 *
 * Words start invisible (opacity:0) and the orchestrator animates them in.
 */
export function AnimatedTitle({
  children,
  className,
  style,
}: {
  children: string;
  className?: string;
  style?: CSSProperties;
}) {
  const text = children;
  const words = text.split(/\s+/);

  return (
    <span className={className} style={style}>
      {words.map((word, i) => (
        <span
          key={i}
          data-animate={AnimationTarget.TitleWord}
          style={{ display: "inline-block", opacity: 0 }}
        >
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}
