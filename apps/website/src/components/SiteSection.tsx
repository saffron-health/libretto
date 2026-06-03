import type { PropsWithChildren } from "react";

type SiteSectionWidth = "md" | "lg" | "none";

const widthClasses: Record<SiteSectionWidth, string> = {
  md: "max-w-[1000px]",
  lg: "max-w-[1100px]",
  none: "",
};

interface SiteSectionProps {
  className?: string;
  id?: string;
  innerClassName?: string;
  width?: SiteSectionWidth;
}

export function SiteSection({
  children,
  className = "",
  id,
  innerClassName = "",
  width = "md",
}: PropsWithChildren<SiteSectionProps>) {
  const innerClasses = ["mx-auto", widthClasses[width], innerClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <section id={id} className={`section-crt px-8 py-24 ${className}`.trim()}>
      <div className={innerClasses}>{children}</div>
    </section>
  );
}
