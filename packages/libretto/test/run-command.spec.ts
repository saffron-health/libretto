import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { test } from "./fixtures";
import {
  detectPackageManager,
  packageManagerRunCommand,
  runCommand,
} from "../src/cli/core/run-command.js";

const tempDirs: string[] = [];

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "libretto-run-command-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("run command formatting", () => {
  it("maps package managers to their binary runners", () => {
    expect(packageManagerRunCommand("npm")).toBe("npx");
    expect(packageManagerRunCommand("pnpm")).toBe("pnpm exec");
    expect(packageManagerRunCommand("yarn")).toBe("yarn");
    expect(packageManagerRunCommand("bun")).toBe("bunx");
  });

  it("detects the package manager from npm_config_user_agent", () => {
    expect(
      detectPackageManager(process.cwd(), {
        npm_config_user_agent: "npm/10.0.0 node/v20.0.0",
      }),
    ).toBe("npm");
    expect(
      detectPackageManager(process.cwd(), {
        npm_config_user_agent: "pnpm/10.33.0 npm/? node/v20.0.0",
      }),
    ).toBe("pnpm");
    expect(
      detectPackageManager(process.cwd(), {
        npm_config_user_agent: "yarn/1.22.22 npm/? node/v20.0.0",
      }),
    ).toBe("yarn");
    expect(
      detectPackageManager(process.cwd(), {
        npm_config_user_agent: "bun/1.2.0 npm/? node/v20.0.0",
      }),
    ).toBe("bun");
  });

  it("falls back to workspace lockfiles when no user agent is present", async () => {
    const pnpmWorkspace = await tempWorkspace();
    await writeFile(join(pnpmWorkspace, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(pnpmWorkspace, {})).toBe("pnpm");

    const yarnWorkspace = await tempWorkspace();
    await writeFile(join(yarnWorkspace, "yarn.lock"), "");
    expect(detectPackageManager(yarnWorkspace, {})).toBe("yarn");

    const bunWorkspace = await tempWorkspace();
    await writeFile(join(bunWorkspace, "bun.lock"), "");
    expect(detectPackageManager(bunWorkspace, {})).toBe("bun");
  });

  it("formats a complete libretto command", () => {
    expect(runCommand("setup")).toContain(" libretto setup");
  });
});

test("CLI help and usage use the invoker package manager command", async ({
  librettoCli,
}) => {
  const cases = [
    ["npm/10.0.0 node/v20.0.0", "npx libretto"],
    ["pnpm/10.33.0 npm/? node/v20.0.0", "pnpm exec libretto"],
    ["yarn/1.22.22 npm/? node/v20.0.0", "yarn libretto"],
    ["bun/1.2.0 npm/? node/v20.0.0", "bunx libretto"],
  ] as const;

  for (const [userAgent, command] of cases) {
    const env = { npm_config_user_agent: userAgent };

    const help = await librettoCli("help", env);
    expect(help.stdout).toContain(`Usage: ${command} <command>`);

    const openUsage = await librettoCli("open", env);
    expect(openUsage.stderr).toContain(`Usage: ${command} open <url>`);

    const runUsage = await librettoCli("run", env);
    expect(runUsage.stderr).toContain(`Usage: ${command} run <integrationFile>`);

    const setup = await librettoCli("setup --skip-browsers", {
      ...env,
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });
    expect(setup.stdout).toContain(
      `To change: ${command} ai configure openai | anthropic | gemini | vertex`,
    );
  }
});
