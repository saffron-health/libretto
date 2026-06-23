import type * as React from "react";

type AppLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function AppLink({ href, target, download, ...props }: AppLinkProps) {
  return <a href={href} target={target} download={download} {...props} />;
}
