import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PROFILES_DIR } from "./context.js";
import type { AuthProfileStorageState } from "../../shared/workflow/auth-profile-state.js";

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type LocalAuthProfile = AuthProfileStorageState;

export function normalizeProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Profile name is required.");
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    basename(trimmed) !== trimmed ||
    !PROFILE_NAME_PATTERN.test(trimmed)
  ) {
    throw new Error(
      `Invalid profile name "${name}". Use letters, numbers, dots, underscores, and dashes only.`,
    );
  }
  return trimmed;
}

export function getProfilePath(profileName: string): string {
  return join(PROFILES_DIR, `${normalizeProfileName(profileName)}.json`);
}

export function hasProfile(profileName: string): boolean {
  return existsSync(getProfilePath(profileName));
}

export function readProfile(profileName: string): LocalAuthProfile {
  const profilePath = getProfilePath(profileName);
  const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Saved auth profile "${profileName}" is not a JSON object.`);
  }
  return parsed as LocalAuthProfile;
}

export async function writeProfile(
  profileName: string,
  profile: LocalAuthProfile,
): Promise<string> {
  const profilePath = getProfilePath(profileName);
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
  return profilePath;
}
