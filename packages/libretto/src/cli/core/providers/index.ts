import { readLibrettoConfig } from "../config.js";
import { createBrowserbaseProvider } from "./browserbase.js";
import { createKernelProvider } from "./kernel.js";
import type { ProviderApi } from "./types.js";

const PROVIDER_NAMES = ["local", "kernel", "browserbase"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const VALID_PROVIDER_NAMES = new Set<string>(PROVIDER_NAMES);

function assertValidProviderName(value: string, source: string): ProviderName {
  if (!VALID_PROVIDER_NAMES.has(value)) {
    throw new Error(
      `Invalid provider "${value}" from ${source}. Valid providers: ${PROVIDER_NAMES.join(", ")}`,
    );
  }
  return value as ProviderName;
}

/**
 * Resolve which provider to use.
 * Precedence: CLI flag > LIBRETTO_PROVIDER env var > config file > "local" default.
 */
export function resolveProviderName(cliFlag?: string): ProviderName {
  if (cliFlag) {
    return assertValidProviderName(cliFlag, "--provider flag");
  }

  const envVar = process.env.LIBRETTO_PROVIDER;
  if (envVar) {
    return assertValidProviderName(envVar, "LIBRETTO_PROVIDER env var");
  }

  const config = readLibrettoConfig();
  if (config.provider) {
    return assertValidProviderName(config.provider, "config file");
  }

  return "local";
}

/**
 * Get a ProviderApi instance for a cloud provider.
 * Only call this for non-"local" providers.
 */
export function getProvider(name: string): ProviderApi {
  switch (name) {
    case "kernel":
      return createKernelProvider();
    case "browserbase":
      return createBrowserbaseProvider();
    default:
      throw new Error(
        `Unknown provider "${name}". Valid cloud providers: kernel, browserbase`,
      );
  }
}

export type { ProviderApi, ProviderSession } from "./types.js";
