import type * as React from "react";

type Variant =
  | "default"
  | "destructive"
  | "destructive-outline"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

type Size =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "xl"
  | "icon"
  | "icon-sm"
  | "icon-lg"
  | "icon-xl"
  | "icon-xs";

const base =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0";

const variantClasses: Record<Variant, string> = {
  default:
    "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs hover:bg-primary/90 active:bg-primary/90 disabled:shadow-none active:shadow-none",
  destructive:
    "border-destructive bg-destructive text-white shadow-destructive/24 shadow-xs hover:bg-destructive/90 active:bg-destructive/90 disabled:shadow-none active:shadow-none",
  "destructive-outline":
    "border-input bg-popover text-destructive-foreground shadow-xs/5 hover:border-destructive/32 hover:bg-destructive/4 active:border-destructive/32 active:bg-destructive/4 disabled:shadow-none active:shadow-none",
  outline:
    "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 active:bg-accent/50 disabled:shadow-none active:shadow-none",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 active:bg-secondary/80",
  ghost: "border-transparent text-foreground hover:bg-accent active:bg-accent",
  link: "border-transparent text-foreground underline-offset-4 hover:underline active:underline",
};

const sizeClasses: Record<Size, string> = {
  default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
  xs: "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
  sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
  lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
  xl: "h-11 px-[calc(--spacing(4)-1px)] text-lg sm:h-10 sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
  icon: "size-9 sm:size-8",
  "icon-sm": "size-8 sm:size-7",
  "icon-lg": "size-10 sm:size-9",
  "icon-xl":
    "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
  "icon-xs":
    "size-7 rounded-md sm:size-6 [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  className = "",
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled = Boolean(loading || disabled);

  const classes = [
    base,
    variantClasses[variant],
    sizeClasses[size],
    loading ? "select-none text-transparent" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      disabled={isDisabled}
      aria-disabled={loading || undefined}
      data-loading={loading ? "" : undefined}
      data-slot="button"
      type={type}
      {...props}
    >
      {children}
      {loading && (
        <svg
          className="pointer-events-none absolute size-4 animate-spin"
          data-slot="button-loading-indicator"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
    </button>
  );
}
