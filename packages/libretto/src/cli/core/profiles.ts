import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROFILES_DIR } from "./context.js";
import type { AuthProfileStorageState } from "../../shared/workflow/auth-profile-state.js";
import { normalizeProfileName } from "../../shared/workflow/auth-profile-name.js";

export { normalizeProfileName } from "../../shared/workflow/auth-profile-name.js";

export function getProfilePath(profileName: string): string {
  return join(PROFILES_DIR, `${normalizeProfileName(profileName)}.json`);
}

export function hasProfile(profileName: string): boolean {
  return existsSync(getProfilePath(profileName));
}

export function readProfile(profileName: string): AuthProfileStorageState {
  const profilePath = getProfilePath(profileName);
  const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Saved auth profile "${profileName}" is not a JSON object.`);
  }
  return parsed as AuthProfileStorageState;
}

export async function writeProfile(
  profileName: string,
  profile: AuthProfileStorageState,
): Promise<string> {
  const profilePath = getProfilePath(profileName);
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
  return profilePath;
}

export function formatMissingLocalAuthProfileMessage(args: {
  profileName: string;
  profilePath: string;
  session: string;
}): string {
  return [
    `Local auth profile not found: "${args.profileName}".`,
    `Expected profile file: ${args.profilePath}`,
    "To create it locally:",
    `  1. libretto open <site-url> --headed --session ${args.session}`,
    "  2. Log in manually in the browser window.",
    `  3. libretto save ${args.profileName} --session ${args.session} --sites <site>`,
    "Or import site-scoped state from Chrome with:",
    `  libretto import-chrome-profiles ${args.profileName} --cdp-url <url> --sites <site>`,
    "Local profile files are not uploaded to cloud profiles.",
  ].join("\n");
}
