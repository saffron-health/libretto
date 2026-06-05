import type { BrowserContext } from "playwright";

export type AuthProfileStorageState = {
  sites?: string[];
  cookies?: unknown[];
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
    indexedDB?: unknown;
  }>;
};

export function parseAuthProfileSites(value: string): string[] {
  const sites = value
    .split(",")
    .map((entry) => normalizeAuthProfileSite(entry))
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set(sites)];
}

export function normalizeAuthProfileSite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return normalizeHost(url.hostname);
  } catch {
    const normalized = normalizeHost(trimmed);
    return normalized || null;
  }
}

export async function captureAuthProfileStorageState(
  context: BrowserContext,
  sites: readonly string[],
): Promise<AuthProfileStorageState> {
  const normalizedSites = [...new Set(
    sites
      .map((site) => normalizeAuthProfileSite(site))
      .filter((site): site is string => Boolean(site)),
  )];
  if (normalizedSites.length === 0) {
    throw new Error("At least one auth profile site is required.");
  }

  const state = await context.storageState({ indexedDB: true });
  return {
    sites: normalizedSites,
    cookies: state.cookies.filter((cookie) =>
      cookieDomainMatchesSites(cookie.domain, normalizedSites),
    ),
    origins: state.origins.filter((origin) =>
      originMatchesSites(origin.origin, normalizedSites),
    ),
  };
}

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  while (host.startsWith(".")) host = host.slice(1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function cookieDomainMatchesSites(
  cookieDomain: string,
  sites: readonly string[],
): boolean {
  const domain = normalizeHost(cookieDomain);
  if (!domain) return false;
  return sites.some(
    (site) =>
      domain === site ||
      domain.endsWith(`.${site}`) ||
      site.endsWith(`.${domain}`),
  );
}

function originMatchesSites(origin: string, sites: readonly string[]): boolean {
  try {
    const host = normalizeHost(new URL(origin).hostname);
    return sites.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}
