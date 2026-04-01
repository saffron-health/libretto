import type * as React from "react";
import { Link } from "wouter";

type AppLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function normalizeAppPathname(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function isAppOwnedPathname(pathname: string): boolean {
  const normalizedPathname = normalizeAppPathname(pathname);

  return (
    normalizedPathname === "/" ||
    normalizedPathname === "/docs" ||
    normalizedPathname === "/docs/index.html" ||
    normalizedPathname.startsWith("/docs/")
  );
}

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

    if (!isAppOwnedPathname(url.pathname)) {
      return false;
    }

    const currentPathname = normalizeAppPathname(window.location.pathname);
    const nextPathname = normalizeAppPathname(url.pathname);
    const isSameDocumentHashNavigation =
      nextPathname === currentPathname &&
      url.search === window.location.search &&
      Boolean(url.hash);

    return !isSameDocumentHashNavigation;
  } catch {
    return false;
  }
}

export function AppLink({ href, target, download, ...props }: AppLinkProps) {
  if (shouldUseSpaNavigation({ href, target, download })) {
    return <Link href={href} target={target} download={download} {...props} />;
  }

  return <a href={href} target={target} download={download} {...props} />;
}
