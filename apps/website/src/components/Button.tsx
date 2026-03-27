import type * as React from "react";

type ButtonSize = "default" | "sm";

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64";

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
  sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
}

export function Button({
  className = "",
  size = "default",
  type = "button",
  ...props
}: ButtonProps): React.ReactElement {
  return (
    <button
      className={[base, sizeClasses[size], className].filter(Boolean).join(" ")}
      type={type}
      {...props}
    />
  );
}
