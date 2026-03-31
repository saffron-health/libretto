import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimpleCLI } from "../framework/simple-cli.js";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function findLibrettoPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readJson(packageJsonPath) as { name?: unknown };
      if (packageJson.name === "libretto") {
        return dir;
      }
    }
    dir = dirname(dir);
  }

  throw new Error("Could not locate the installed libretto package root.");
}

function getInstalledLibrettoVersion(): string {
  const packageJson = readJson(join(findLibrettoPackageRoot(), "package.json")) as {
    version?: unknown;
  };
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("Could not determine the installed libretto version.");
  }
  return packageJson.version;
}

function buildNpmInitArgs(input: { skipBrowsers: boolean }): string[] {
  const args = ["init", `libretto@${getInstalledLibrettoVersion()}`];
  if (input.skipBrowsers) {
    args.push("--", "--skip-browsers");
  }
  return args;
}

function runSetup(options: { skipBrowsers: boolean }): void {
  const args = buildNpmInitArgs({
    skipBrowsers: options.skipBrowsers,
  });
  const renderedCommand = ["npm", ...args].join(" ");

  console.log(`Re-running Libretto setup via: ${renderedCommand}`);

  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    throw new Error(
      `Failed to launch npm for setup refresh (${renderedCommand}): ${result.error.message}`,
    );
  }

  throw new Error(
    `Libretto setup refresh failed (${renderedCommand}). Try running the command directly for full logs.`,
  );
}

export const setupInput = SimpleCLI.input({
  positionals: [],
  named: {
    skipBrowsers: SimpleCLI.flag({
      name: "skip-browsers",
      help: "Skip Playwright Chromium installation",
    }),
  },
});

export const setupCommand = SimpleCLI.command({
  description:
    "Rerun Libretto setup via npm init for the currently installed version",
})
  .input(setupInput)
  .handle(async ({ input }) => {
    runSetup({
      skipBrowsers: input.skipBrowsers,
    });
  });
