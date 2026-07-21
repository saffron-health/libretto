export function getSafeReturnTo(search = window.location.search): string | null {
  const rawReturnTo = new URLSearchParams(search).get("returnTo");
  if (!rawReturnTo) return null;
  try {
    const parsed = new URL(rawReturnTo, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function withReturnTo(path: string, returnTo: string | null): string {
  if (!returnTo) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("returnTo", returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sanitizeReturnToForAuthState(
  returnTo: string | null,
  hasTenant: boolean,
): string | null {
  if (!returnTo) return null;
  const parsed = new URL(returnTo, window.location.origin);
  const pathname = parsed.pathname;

  if (
    pathname === "/signin" ||
    pathname === "/verify-email" ||
    pathname === "/onboarding"
  ) {
    return null;
  }

  if (
    !hasTenant &&
    (pathname === "/dashboard" ||
      pathname === "/setup")
  ) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function postAuthRedirect(input: {
  emailVerified: boolean;
  hasTenant: boolean;
  setupComplete: boolean;
  returnTo: string | null;
}): string {
  const returnTo = sanitizeReturnToForAuthState(input.returnTo, input.hasTenant);
  if (!input.emailVerified) return withReturnTo("/verify-email", returnTo);
  if (!input.hasTenant) return withReturnTo("/onboarding", returnTo);
  if (
    !input.setupComplete &&
    returnTo &&
    new URL(returnTo, window.location.origin).pathname.startsWith("/dashboard") &&
    new URL(returnTo, window.location.origin).pathname !== "/dashboard/cloud-browsers"
  ) {
    return "/setup";
  }
  return returnTo ?? (input.setupComplete ? "/dashboard" : "/setup");
}
