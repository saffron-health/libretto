import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SimpleCLI } from "affordance";

const UPDATE_COMMAND = "curl -fsSL https://libretto.sh/install.sh | bash";

type PackageManifest = {
  version?: string;
};

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
): string {
  const knownState =
    status === null
      ? `installer was interrupted${signal ? ` by ${signal}` : ""}.`
      : `installer exited with status ${status}.`;

  return [
    "Error: failed to update Libretto to the latest version.",
    `Known state: ${knownState}`,
    `Try: ${UPDATE_COMMAND}`,
    "Help: libretto help update",
  ].join("\n");
}

export const updateCommand = SimpleCLI.command({
  description: "Update Libretto to the latest version",
})
  .input(updateInput)
  .handle(async ({ input }) => {
    if (input.dryRun) {
      console.log("Update command:");
      console.log(`  ${UPDATE_COMMAND}`);
      console.log("No changes made.");
      return;
    }

    const currentVersion = readCurrentCliVersion();
    const latestVersion = readLatestNpmVersion();
    console.log(`Current version: ${currentVersion}`);
    console.log(`Latest version: ${latestVersion}`);

    if (currentVersion === latestVersion) {
      console.log(`Libretto is already up to date (${currentVersion}).`);
      console.log("No further action required.");
      return;
    }

    console.log("Updating Libretto to latest...");
    const result = spawnSync("bash", ["-lc", UPDATE_COMMAND], {
      stdio: "inherit",
      env: {
        ...process.env,
        LIBRETTO_VERSION: "latest",
      },
    });

    if (result.error) {
      throw new Error(
        [
          "Error: failed to start the Libretto installer.",
          `Known state: ${result.error.message}`,
          `Try: ${UPDATE_COMMAND}`,
          "Help: libretto help update",
        ].join("\n"),
      );
    }

    if (result.status !== 0) {
      throw new Error(formatUpdateFailure(result.status, result.signal));
    }

    console.log("Libretto updated to latest.");
    console.log("No further action required.");
  });
