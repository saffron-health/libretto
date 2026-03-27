import type * as React from "react";

type ButtonSize = "default" | "sm";

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64";

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
  sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
};

type ButtonAsButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: undefined;
};

type ButtonAsAnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

type ButtonProps = (ButtonAsButtonProps | ButtonAsAnchorProps) & {
  size?: ButtonSize;
};

export function Button(props: ButtonAsButtonProps & { size?: ButtonSize }): React.ReactElement;
export function Button(props: ButtonAsAnchorProps & { size?: ButtonSize }): React.ReactElement;
export function Button({
  className = "",
  size = "default",
  ...props
}: ButtonProps): React.ReactElement {
  const classes = [base, sizeClasses[size], className].filter(Boolean).join(" ");

  if (typeof props.href === "string") {
    const anchorProps = props as ButtonAsAnchorProps;
    return <a className={classes} {...anchorProps} />;
  }

  const buttonProps = props as ButtonAsButtonProps;
  return <button className={classes} type={buttonProps.type ?? "button"} {...buttonProps} />;
}
