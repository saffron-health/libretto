import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall, resolveApiUrl } from "../core/auth-fetch.js";

const CLOUD_CREDENTIAL_ENV_PREFIX = "LIBRETTO_CLOUD_";

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
  description: "Push LIBRETTO_CLOUD-prefixed env credentials to Libretto Cloud",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("name", z.string(), {
        help: "Credential name to create or overwrite",
      }),
    ],
    named: {},
  }))
  .handle(async ({ input }) => {
    const credentials = parseEnvCredentials(CLOUD_CREDENTIAL_ENV_PREFIX);
    if (Object.keys(credentials).length === 0) {
      throw new Error(
        `No env vars found with prefix ${CLOUD_CREDENTIAL_ENV_PREFIX}.`,
      );
    }
    const { apiUrl, credential } = requireApiKeyCredential();
    const response = await orpcCall<UpsertCredentialResponse>({
      apiUrl,
      path: "/v1/credentials/upsert",
      input: {
        name: input.name,
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

export const cloudCredentialCommands = SimpleCLI.group({
  description: "Manage hosted credentials",
  routes: {
    push: pushCredentialCommand,
  },
});
