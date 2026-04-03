import type { JSX } from "react";

type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";

const sizeClasses: Record<Size, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
  "5xl": "text-5xl",
};

interface TextProps {
  size?: Size;
  style?: "serif" | "sans";
  as?: keyof JSX.IntrinsicElements;
  id?: string;
  className?: string;
  children: React.ReactNode;
  htmlStyle?: React.CSSProperties;
  [key: `data-${string}`]: string | undefined;
}

export function Text({
  size = "md",
  style = "sans",
  as: Tag = "span",
  className = "",
  children,
  htmlStyle,
  ...rest
}: TextProps) {
  const font = style === "serif" ? "font-serif" : "font-sans";
  const classes = `${sizeClasses[size]} ${font} ${className}`.trim();

  return (
    <Tag className={classes} style={htmlStyle} {...rest}>
      {children}
    </Tag>
  );
}
