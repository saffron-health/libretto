function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string") result[key] = rawValue;
  }
  return result;
}

function readHostedCredentials(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const record = input as Record<string, unknown>;
  return asStringMap(record.credentials);
}

export function readCredentialInputsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("LIBRETTO_CLOUD_") || value === undefined) continue;
    if (value.trim().length === 0) continue;
    const name = key.slice("LIBRETTO_CLOUD_".length).toLowerCase();
    if (!name || name === "api_key") continue;
    credentials[name] = value;
  }
  return credentials;
}

export function normalizeCredentialNames(
  names: readonly string[] | undefined,
): string[] {
  if (!names) return [];
  const normalized = new Set<string>();
  for (const name of names) {
    const value = name.trim().toLowerCase();
    if (value.length > 0) normalized.add(value);
  }
  return [...normalized];
}

function filterCredentialMap(
  credentials: Record<string, string>,
  names: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    if (credentials[name] !== undefined) result[name] = credentials[name];
  }
  return result;
}

function shouldReadCredentialInputsFromEnv(env: NodeJS.ProcessEnv): boolean {
  return (env.LIBRETTO_HOSTED_RUNTIME?.trim().length ?? 0) === 0;
}

export function mergeCredentialsIntoInput(
  input: unknown,
  credentialNames?: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const normalizedNames = normalizeCredentialNames(credentialNames);
  if (normalizedNames.length === 0) return input;

  const existingCredentials = readHostedCredentials(input);
  const envCredentials = shouldReadCredentialInputsFromEnv(env)
    ? readCredentialInputsFromEnv(env)
    : {};
  const mergedCredentials = {
    ...filterCredentialMap(envCredentials, normalizedNames),
    ...filterCredentialMap(existingCredentials, normalizedNames),
  };

  if (Object.keys(mergedCredentials).length === 0) return input;

  const base =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};

  return {
    ...base,
    credentials: mergedCredentials,
  };
}
