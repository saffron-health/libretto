import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey } from "./shared.js";

const CLOUD_CREDENTIAL_ENV_PREFIX = "LIBRETTO_CLOUD_";

type UpsertCredentialResponse = {
  success: true;
  credential_id: string;
  overwritten: boolean;
  message: string;
};

function parseEnvCredentials(prefix: string): Array<{ name: string; value: string }> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    if (value.trim().length === 0) continue;
    const fieldName = key.slice(prefix.length).toLowerCase();
    if (!fieldName || fieldName === "api_key") continue;
    credentials[fieldName] = value;
  }
  return Object.entries(credentials)
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const pushCredentialCommand = SimpleCLI.command({
  description: "Push LIBRETTO_CLOUD-prefixed env credentials to Libretto Cloud",
})
  .input(SimpleCLI.input({
    positionals: [],
    named: {},
  }))
  .use(withCloudApiKey("manage Libretto Cloud credentials"))
  .handle(async ({ ctx }) => {
    const credentials = parseEnvCredentials(CLOUD_CREDENTIAL_ENV_PREFIX);
    if (credentials.length === 0) {
      throw new Error(
        `No non-empty env vars found with prefix ${CLOUD_CREDENTIAL_ENV_PREFIX}.`,
      );
    }
    let created = 0;
    let updated = 0;
    for (const item of credentials) {
      const response = await orpcCall<UpsertCredentialResponse>({
        apiUrl: ctx.apiUrl,
        path: "/v1/credentials/upsert",
        input: item,
        credential: ctx.credential,
      });
      if (response.overwritten) {
        updated += 1;
        console.log(`Updated cloud credential: ${item.name}`);
      } else {
        created += 1;
        console.log(`Created cloud credential: ${item.name}`);
      }
    }
    console.log(
      `Pushed ${credentials.length} cloud ${credentials.length === 1 ? "credential" : "credentials"} (${created} created, ${updated} updated).`,
    );
  });

export const cloudCredentialCommands = SimpleCLI.group({
  description: "Manage hosted credentials",
  routes: {
    push: pushCredentialCommand,
  },
});
