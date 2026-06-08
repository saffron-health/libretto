import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall, resolveApiUrl } from "../core/auth-fetch.js";
import { normalizeProfileName } from "../core/profiles.js";

type ListProfilesResponse = {
  profiles: Array<{
    profile_id: string;
    name: string;
    providers: string[];
    updated_at: string;
  }>;
};

type DeleteProfileResponse = {
  success: boolean;
  deleted_count: number;
};

function requireApiKeyCredential() {
  const apiKey = process.env.LIBRETTO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LIBRETTO_API_KEY is required to manage Libretto Cloud profiles. Issue one with `libretto cloud auth api-key issue --label <label>`.",
    );
  }
  return {
    apiUrl: resolveApiUrl(null),
    credential: { source: "env-api-key" as const, apiKey },
  };
}

export const listProfilesCommand = SimpleCLI.command({
  description: "List Libretto Cloud auth profiles",
})
  .input(SimpleCLI.input({ positionals: [], named: {} }))
  .handle(async () => {
    const { apiUrl, credential } = requireApiKeyCredential();
    const response = await orpcCall<ListProfilesResponse>({
      apiUrl,
      path: "/v1/browserProfiles/list",
      input: {},
      credential,
    });
    if (response.profiles.length === 0) {
      console.log("No cloud profiles found.");
      return;
    }
    for (const profile of response.profiles) {
      const providers = profile.providers.length
        ? ` (${profile.providers.join(", ")})`
        : "";
      console.log(`${profile.name}${providers}`);
    }
  });

export const deleteProfileCommand = SimpleCLI.command({
  description: "Delete a Libretto Cloud auth profile",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("profileName", z.string(), {
        help: "Cloud profile name to delete",
      }),
    ],
    named: {},
  }))
  .handle(async ({ input }) => {
    const profileName = normalizeProfileName(input.profileName);
    const { apiUrl, credential } = requireApiKeyCredential();
    const response = await orpcCall<DeleteProfileResponse>({
      apiUrl,
      path: "/v1/browserProfiles/delete",
      input: { name: profileName },
      credential,
    });
    if (!response.success || response.deleted_count === 0) {
      console.log(`No cloud profile found for ${profileName}.`);
      return;
    }
    console.log(`Deleted cloud profile: ${profileName}`);
  });

export const profileCommands = SimpleCLI.group({
  description: "Manage hosted browser auth profiles",
  routes: {
    list: listProfilesCommand,
    delete: deleteProfileCommand,
  },
});
