import type * as React from "react";
import { AppLink } from "../routing";

type ButtonSize = "default" | "sm";

const base =
  "libretto-button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap text-center no-underline outline-none disabled:pointer-events-none disabled:opacity-64";

const sizeClasses: Record<ButtonSize, string> = {
  default: "libretto-button--default",
  sm: "libretto-button--sm",
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
    return <AppLink className={classes} {...anchorProps} />;
  }

  const buttonProps = props as ButtonAsButtonProps;
  return (
    <button
      {...buttonProps}
      className={classes}
      type={buttonProps.type ?? "button"}
    />
  );
}
