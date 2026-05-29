import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall, resolveApiUrl } from "../core/auth-fetch.js";

type UpsertCredentialResponse = {
  success: true;
  credential_id: string;
  overwritten: boolean;
  message: string;
};

function requireApiKeyCredential() {
  const apiKey = process.env.LIBRETTO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LIBRETTO_API_KEY is required to manage Libretto Cloud credentials. Issue one with `libretto cloud auth api-key issue --label <label>`.",
    );
  }
  return {
    apiUrl: resolveApiUrl(null),
    credential: { source: "env-api-key" as const, apiKey },
  };
}

function parseEnvCredentials(prefix: string): Record<string, string> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    const fieldName = key.slice(prefix.length).toLowerCase();
    if (!fieldName || fieldName === "api_key") continue;
    credentials[fieldName] = value;
  }
  return credentials;
}

export const pushCredentialCommand = SimpleCLI.command({
  description: "Push LIBRETTO-prefixed env credentials to Libretto Cloud",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("name", z.string().optional(), {
        help: "Credential name to create or overwrite",
      }),
    ],
    named: {
      prefix: SimpleCLI.option(z.string().optional(), {
        help: "Environment variable prefix to push, e.g. LIBRETTO_TWITTER_",
      }),
    },
  }).refine(
    (input) => Boolean(input.name),
    "Usage: libretto cloud credentials push <name> --prefix LIBRETTO_<NAME>_",
  ))
  .handle(async ({ input }) => {
    const prefix = input.prefix ?? `LIBRETTO_${input.name!.toUpperCase()}_`;
    if (!prefix.startsWith("LIBRETTO_")) {
      throw new Error("Credential env prefix must start with LIBRETTO_.");
    }
    const credentials = parseEnvCredentials(prefix);
    if (Object.keys(credentials).length === 0) {
      throw new Error(`No env vars found with prefix ${prefix}.`);
    }
    const { apiUrl, credential } = requireApiKeyCredential();
    const response = await orpcCall<UpsertCredentialResponse>({
      apiUrl,
      path: "/v1/credentials/upsert",
      input: {
        name: input.name!,
        credentials,
      },
      credential,
    });
    console.log(
      response.overwritten
        ? `Updated cloud credential: ${input.name}`
        : `Created cloud credential: ${input.name}`,
    );
    console.log(`Credential ID: ${response.credential_id}`);
  });

export const credentialCommands = SimpleCLI.group({
  description: "Manage hosted credentials",
  routes: {
    push: pushCredentialCommand,
  },
});
