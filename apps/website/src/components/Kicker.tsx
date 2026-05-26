import type { JSX } from "react";

interface KickerProps {
  as?: keyof JSX.IntrinsicElements;
  children: React.ReactNode;
  className?: string;
}

export function Kicker({
  as: Tag = "span",
  children,
  className = "",
}: KickerProps) {
  return (
    <Tag
      className={`block font-mono text-base text-amber ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
