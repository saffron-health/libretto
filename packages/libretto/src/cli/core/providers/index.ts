import { readLibrettoConfig } from "../config.js";
import { createBrowserbaseProvider } from "./browserbase.js";
import { createKernelProvider } from "./kernel.js";
import type { ProviderApi } from "./types.js";

const VALID_PROVIDERS = new Set(["local", "kernel", "browserbase"] as const);
export type ProviderName =
  typeof VALID_PROVIDERS extends Set<infer T> ? T : never;

function assertValidProviderName(value: string, source: string): ProviderName {
  if (!VALID_PROVIDERS.has(value as ProviderName)) {
    throw new Error(
      `Invalid provider "${value}" from ${source}. Valid providers: ${[...VALID_PROVIDERS].join(", ")}`,
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
export function getCloudProviderApi(name: string): ProviderApi {
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
