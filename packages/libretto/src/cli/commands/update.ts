import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimpleCLI } from "affordance";
import { REPO_ROOT } from "../core/context.js";
import {
  detectProjectPackageManager,
  installCommand,
  type PackageManager,
} from "../../shared/package-manager.js";

type PackageManifest = {
  version?: string;
};

function packageInstallCommand(
  packageManager: PackageManager,
  packageSpec: string,
): string {
  return `${installCommand(packageManager)} ${packageSpec}`;
}

function readCurrentCliVersion(): string {
  const packageJsonPath = fileURLToPath(
    new URL("../../../package.json", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageManifest;

  if (!manifest.version) {
    throw new Error(
      `Unable to determine current libretto version from ${packageJsonPath}.`,
    );
  }

  return manifest.version;
}

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as PackageManifest;
    return manifest.version?.trim() || null;
  } catch {
    return null;
  }
}

function readLocalPackageVersion(): string | null {
  return readPackageVersion(
    join(REPO_ROOT, "node_modules", "libretto", "package.json"),
  );
}

function readLatestNpmVersion(): string {
  const result = spawnSync("npm", ["view", "libretto@latest", "version"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(
      [
        "Error: failed to check the latest Libretto version on npm.",
        `Known state: ${result.error.message}`,
        "Try: npm view libretto@latest version",
        "Help: libretto help update",
      ].join("\n"),
    );
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      [
        "Error: failed to check the latest Libretto version on npm.",
        `Known state: npm exited with status ${result.status}.`,
        ...(detail ? [`npm stderr: ${detail}`] : []),
        "Try: npm view libretto@latest version",
        "Help: libretto help update",
      ].join("\n"),
    );
  }

  const version = result.stdout.trim();
  if (!version) {
    throw new Error(
      [
        "Error: failed to check the latest Libretto version on npm.",
        "Known state: npm did not print a version.",
        "Try: npm view libretto@latest version",
        "Help: libretto help update",
      ].join("\n"),
    );
  }

  return version;
}

export const updateInput = SimpleCLI.input({
  positionals: [],
  named: {
    dryRun: SimpleCLI.flag({
      name: "dry-run",
      help: "Print the update command without running it",
    }),
  },
});

function formatUpdateFailure(
  status: number | null,
  signal: string | null,
  updateCommand: string,
): string {
  const knownState =
    status === null
      ? `package update was interrupted${signal ? ` by ${signal}` : ""}.`
      : `package update exited with status ${status}.`;

  return [
    "Error: failed to update Libretto to the latest version.",
    `Known state: ${knownState}`,
    `Try: ${updateCommand}`,
    "Help: libretto help update",
  ].join("\n");
}

export const updateCommand = SimpleCLI.command({
  description: "Update Libretto to the latest version",
})
  .input(updateInput)
  .handle(async ({ input }) => {
    const packageManager = detectProjectPackageManager();
    const updateCommand = packageInstallCommand(packageManager, "libretto@latest");

    if (input.dryRun) {
      console.log("Update command:");
      console.log(`  ${updateCommand}`);
      console.log("No changes made.");
      return;
    }

    const currentVersion = readCurrentCliVersion();
    const localPackageVersion = readLocalPackageVersion();
    const installedVersion = localPackageVersion ?? currentVersion;
    const latestVersion = readLatestNpmVersion();
    console.log(`Current version: ${installedVersion}`);
    console.log(`Latest version: ${latestVersion}`);

    if (localPackageVersion && installedVersion === latestVersion) {
      console.log(`Libretto is already up to date (${installedVersion}).`);
      console.log("No further action required.");
      return;
    }

    if (!localPackageVersion) {
      console.log("Local package: not installed");
    }

    console.log("Updating local Libretto package to latest...");
    const result = spawnSync(updateCommand, {
      stdio: "inherit",
      shell: true,
    });

    if (result.error) {
      throw new Error(
        [
          "Error: failed to start the Libretto package update.",
          `Known state: ${result.error.message}`,
          `Try: ${updateCommand}`,
          "Help: libretto help update",
        ].join("\n"),
      );
    }

    if (result.status !== 0) {
      throw new Error(
        formatUpdateFailure(result.status, result.signal, updateCommand),
      );
    }

    console.log("Local Libretto package updated to latest.");
    console.log("No further action required.");
  });
