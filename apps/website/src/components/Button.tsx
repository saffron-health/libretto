import type * as React from "react";
import { AppLink } from "../routing";

type ButtonSize = "default" | "sm";
type ButtonVariant = "primary" | "secondary";

const base =
  "libretto-button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap text-center no-underline outline-none disabled:pointer-events-none disabled:opacity-64";

const sizeClasses: Record<ButtonSize, string> = {
  default: "libretto-button--default",
  sm: "libretto-button--sm",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "",
  secondary: "libretto-button--secondary",
};

type ButtonAsButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: undefined;
};

type ButtonAsAnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

type ButtonProps = (ButtonAsButtonProps | ButtonAsAnchorProps) & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button(props: ButtonAsButtonProps & { size?: ButtonSize; variant?: ButtonVariant }): React.ReactElement;
export function Button(props: ButtonAsAnchorProps & { size?: ButtonSize; variant?: ButtonVariant }): React.ReactElement;
export function Button({
  className = "",
  size = "default",
  variant = "primary",
  ...props
}: ButtonProps): React.ReactElement {
  const classes = [base, sizeClasses[size], variantClasses[variant], className].filter(Boolean).join(" ");

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
