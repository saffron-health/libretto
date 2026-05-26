import type { PropsWithChildren } from "react";

type PanelPadding = "none" | "sm" | "md" | "lg";
type PanelRadius = "md" | "lg" | "xl";
type PanelTone = "default" | "accent";

const paddingClasses: Record<PanelPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-6",
  lg: "p-7",
};

const radiusClasses: Record<PanelRadius, string> = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
};

const toneClasses: Record<PanelTone, string> = {
  default: "border-rule bg-panel",
  accent: "border-accent/20 bg-panel",
};

interface PanelProps {
  className?: string;
  padding?: PanelPadding;
  radius?: PanelRadius;
  tone?: PanelTone;
}

export function Panel({
  children,
  className = "",
  padding = "md",
  radius = "lg",
  tone = "default",
}: PropsWithChildren<PanelProps>) {
  const classes = [
    "border",
    toneClasses[tone],
    radiusClasses[radius],
    paddingClasses[padding],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}
