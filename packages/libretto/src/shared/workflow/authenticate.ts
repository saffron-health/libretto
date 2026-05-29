import type { LibrettoWorkflowContext } from "./workflow.js";

export type LibrettoAuthenticateOptions = {
  validate: (ctx: LibrettoWorkflowContext) => Promise<boolean> | boolean;
  fallback: (
    ctx: LibrettoWorkflowContext,
    credentials: Record<string, string>,
  ) => Promise<void> | void;
  credentials?: Record<string, unknown>;
  envPrefix?: string;
};

export async function librettoAuthenticate(
  ctx: LibrettoWorkflowContext,
  options: LibrettoAuthenticateOptions,
): Promise<{ usedProfile: boolean }> {
  if (await options.validate(ctx)) {
    return { usedProfile: true };
  }

  const credentials = normalizeCredentials(
    options.credentials ?? readCredentialsFromEnv(options.envPrefix),
  );
  await options.fallback(ctx, credentials);

  if (!(await options.validate(ctx))) {
    throw new Error("Authentication fallback completed, but validation still failed.");
  }

  return { usedProfile: false };
}

function normalizeCredentials(
  credentials: Record<string, unknown>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === "string") normalized[key] = value;
  }
  return normalized;
}

function readCredentialsFromEnv(envPrefix = "LIBRETTO_"): Record<string, string> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(envPrefix) && value !== undefined) {
      const credentialName = key.slice(envPrefix.length).toLowerCase();
      if (isLibrettoControlCredential(envPrefix, credentialName)) continue;
      credentials[credentialName] = value;
    }
  }
  return credentials;
}

function isLibrettoControlCredential(
  envPrefix: string,
  credentialName: string,
): boolean {
  return (
    envPrefix === "LIBRETTO_" &&
    ["api_key", "api_url", "timeout_seconds"].includes(credentialName)
  );
}
