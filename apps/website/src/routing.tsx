import type * as React from "react";
import { Link } from "wouter";

type AppLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

function shouldUseSpaNavigation({
  href,
  target,
  download,
}: {
  href: string;
  target?: React.HTMLAttributeAnchorTarget;
  download?: React.AnchorHTMLAttributes<HTMLAnchorElement>["download"];
}): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (href.startsWith("#")) {
    return false;
  }

  if (target && target !== "_self") {
    return false;
  }

  if (typeof download !== "undefined") {
    return false;
  }

  try {
    const url = new URL(href, window.location.origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    if (url.origin !== window.location.origin) {
      return false;
    }

    if (url.hash || isDocumentPath(url.pathname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isDocumentPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

export function AppLink({ href, target, download, ...props }: AppLinkProps) {
  if (shouldUseSpaNavigation({ href, target, download })) {
    return <Link href={href} target={target} download={download} {...props} />;
  }

  return <a href={href} target={target} download={download} {...props} />;
}
