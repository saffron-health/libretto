import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall, resolveApiUrl } from "../core/auth-fetch.js";
import { readProfile, normalizeProfileName } from "../core/profiles.js";

type UpsertProfileResponse = {
  success: true;
  profile_id: string;
  name: string;
  overwritten: boolean;
};

type ListProfilesResponse = {
  profiles: Array<{
    name: string;
    source: string;
    site: string | null;
    provider: string | null;
    provider_profile_id: string | null;
    updated_at: string;
  }>;
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

export const pushProfileCommand = SimpleCLI.command({
  description: "Push a local auth profile to Libretto Cloud",
})
  .input(SimpleCLI.input({
    positionals: [
      SimpleCLI.positional("profileName", z.string().optional(), {
        help: "Local profile name to push",
      }),
    ],
    named: {
      site: SimpleCLI.option(z.string().optional(), {
        help: "Site or domain this profile authenticates",
      }),
      source: SimpleCLI.option(z.string().default("libretto"), {
        help: "Profile source label",
      }),
    },
  }).refine(
    (input) => Boolean(input.profileName),
    "Usage: libretto cloud profiles push <profile-name> [--site <site>]",
  ))
  .handle(async ({ input }) => {
    const profileName = normalizeProfileName(input.profileName!);
    const storageState = readProfile(profileName) as Record<string, unknown>;
    const { apiUrl, credential } = requireApiKeyCredential();
    const response = await orpcCall<UpsertProfileResponse>({
      apiUrl,
      path: "/v1/browserProfiles/upsert",
      input: {
        name: profileName,
        source: input.source,
        site: input.site ?? null,
        storage_state: storageState,
      },
      credential,
    });
    console.log(
      response.overwritten
        ? `Updated cloud profile: ${response.name}`
        : `Created cloud profile: ${response.name}`,
    );
    console.log(`Profile ID: ${response.profile_id}`);
  });

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
      const site = profile.site ? ` (${profile.site})` : "";
      console.log(`${profile.name}${site} — ${profile.source}`);
    }
  });

export const profileCommands = SimpleCLI.group({
  description: "Manage hosted browser auth profiles",
  routes: {
    push: pushProfileCommand,
    list: listProfilesCommand,
  },
});
