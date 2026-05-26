import type { ReactNode } from "react";
import { Kicker } from "./Kicker.js";
import { SectionHeading } from "./SectionHeading.js";
import { Text } from "./Text.js";

type SectionIntroAlign = "left" | "center";

interface SectionIntroProps {
  align?: SectionIntroAlign;
  children?: ReactNode;
  className?: string;
  copyClassName?: string;
  headingClassName?: string;
  headingSize?: "sm" | "md";
  kicker?: ReactNode;
  title: ReactNode;
}

export function SectionIntro({
  align = "center",
  children,
  className = "",
  copyClassName = "",
  headingClassName = "",
  headingSize = "md",
  kicker,
  title,
}: SectionIntroProps) {
  const textAlign = align === "center" ? "text-center" : "text-left";
  const copyAlignment = align === "center" ? "mx-auto" : "";
  const headingClasses = headingClassName || "mb-4";

  return (
    <div className={`${textAlign} ${className}`.trim()}>
      {kicker ? <Kicker className="mb-3">{kicker}</Kicker> : null}
      <SectionHeading size={headingSize} className={headingClasses}>
        {title}
      </SectionHeading>
      {children ? (
        <Text
          as="p"
          size="md"
          className={`${copyAlignment} max-w-[580px] leading-relaxed text-muted [text-wrap:balance] ${copyClassName}`.trim()}
        >
          {children}
        </Text>
      ) : null}
    </div>
  );
}
