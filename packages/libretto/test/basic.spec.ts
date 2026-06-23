import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import outdent from "outdent";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

const packageJsonUrl = new URL("../package.json", import.meta.url);

function extractReturnedSessionId(output: string): string | null {
  const patterns = [
    /\(session:\s*([a-zA-Z0-9._-]+)\)/i,
    /session id[:=]\s*([a-zA-Z0-9._-]+)/i,
    /session[:=]\s*([a-zA-Z0-9._-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function requireReturnedSessionId(
  command: string,
  stdout: string,
  stderr: string,
): string {
  const combined = `${stdout}\n${stderr}`;
  const sessionId = extractReturnedSessionId(combined);
  if (!sessionId) {
    throw new Error(
      `Could not find a returned session id for "${command}".\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return sessionId;
}

function expectMissingSessionError(output: string, session: string): void {
  expect(output).toContain(`No session "${session}" found.`);
  expect(output).toContain("No active sessions.");
  expect(output).toContain("Start one with:");
  expect(output).toContain(`libretto open <url> --session ${session}`);
}

async function readCliVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
    version: string;
  };
  return manifest.version;
}

async function seedInstalledSkillVersion(
  workspacePath: (...parts: string[]) => string,
  rootDir: ".agents" | ".claude",
  version: string,
): Promise<void> {
  await mkdir(workspacePath(rootDir, "skills", "libretto"), {
    recursive: true,
  });
  await writeFile(
    workspacePath(rootDir, "skills", "libretto", "SKILL.md"),
    `---
name: libretto
metadata:
  version: "${version}"
---
`,
    "utf8",
  );
}

async function seedLocalLibrettoPackageVersion(
  workspacePath: (...parts: string[]) => string,
  version: string,
): Promise<void> {
  await mkdir(workspacePath("node_modules", "libretto"), {
    recursive: true,
  });
  await writeFile(
    workspacePath("node_modules", "libretto", "package.json"),
    JSON.stringify({ name: "libretto", version }),
    "utf8",
  );
}

function expectVersionWarningHeader(stderr: string): void {
  expect(stderr).toContain(
    "WARNING: Libretto skill version does not match the local package.",
  );
}

function expectSkillSetupCommand(stderr: string): void {
  expect(stderr).toContain("Fix: run libretto setup");
}

function expectNoPackageUpdateCommand(stderr: string): void {
  expect(stderr).not.toContain("local package: npm install");
  expect(stderr).not.toContain("local package: pnpm add");
  expect(stderr).not.toContain("local package: yarn add");
  expect(stderr).not.toContain("local package: bun add");
}

function expectedRootHelp(): string {
  return `${outdent`
    Usage: libretto <command>

    Commands:
      open  Launch browser and open URL
      connect  Connect to an existing Chrome DevTools Protocol (CDP) endpoint
      save  Save current browser session
      pages  List open pages in the session
      session-mode  View or set the session access mode
      close  Close the browser
      cloud <subcommand>  Deploy workflows and manage hosted Libretto
      experiments  List or update Libretto experiment flags
      import-chrome-profiles  Fetch scoped auth state from a Chrome CDP session into a local profile
      exec  Execute Playwright TypeScript code
      readonly-exec  Execute read-only Playwright inspection code
      run  Run the default-exported Libretto workflow from a file
      resume  Resume a paused workflow for the current session
      search  Search the current page HTML snapshot
      setup  Set up libretto in the current project
      status  Show workspace status and open sessions
      snapshot  Capture a screenshot and compact accessibility snapshot
      update  Update Libretto to the latest version

    Options:
      --session <name>  Required for session-scoped commands
      -h, --help
      -v, --version
  `}\n`;
}

describe("basic CLI subprocess behavior", () => {
  test("allows package manager exec commands without install warnings", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help", {
      npm_command: "exec",
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: libretto <command>");
  });

  test("does not warn for package manager lifecycle commands", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help", {
      npm_command: "run-script",
      npm_config_user_agent: "pnpm/11.1.1",
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: libretto <command>");
  });

  test("setup completes without AI configuration", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
    });

    expect(result.stdout).toContain("Skipping browser installation");
    expect(result.stdout).toContain("Config set up at");
    expect(result.stdout).toContain("libretto setup complete");
    expect(result.stdout).not.toContain("snapshot API credentials");
    expect(result.stdout).not.toContain("AI config");
  });

  test("setup copies skill files without confirmation when agent dirs exist", async ({
    librettoCli,
    workspacePath,
  }) => {
    await mkdir(workspacePath(".agents", "skills", "libretto"), {
      recursive: true,
    });
    await mkdir(workspacePath(".agents", "skills", "libretto-readonly"), {
      recursive: true,
    });
    await mkdir(workspacePath(".claude"), { recursive: true });
    await writeFile(
      workspacePath(".agents", "skills", "libretto", "stale.txt"),
      "stale",
      "utf8",
    );
    await writeFile(
      workspacePath(".agents", "skills", "libretto-readonly", "stale.txt"),
      "stale",
      "utf8",
    );

    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
    });

    expect(result.stdout).toContain(".agents/skills/libretto/");
    expect(result.stdout).toContain(".agents/skills/libretto-readonly/");
    expect(result.stdout).toContain(".claude/skills/libretto/");
    expect(result.stdout).toContain(".claude/skills/libretto-readonly/");
    await expect(
      readFile(workspacePath(".agents", "skills", "libretto", "SKILL.md"), {
        encoding: "utf8",
      }),
    ).resolves.toContain("name: libretto");
    await expect(
      readFile(workspacePath(".claude", "skills", "libretto", "SKILL.md"), {
        encoding: "utf8",
      }),
    ).resolves.toContain("name: libretto");
    await expect(
      readFile(
        workspacePath(".agents", "skills", "libretto-readonly", "SKILL.md"),
        {
          encoding: "utf8",
        },
      ),
    ).resolves.toContain("name: libretto-readonly");
    await expect(
      readFile(
        workspacePath(".claude", "skills", "libretto-readonly", "SKILL.md"),
        {
          encoding: "utf8",
        },
      ),
    ).resolves.toContain("name: libretto-readonly");
    expect(
      existsSync(workspacePath(".agents", "skills", "libretto", "stale.txt")),
    ).toBe(false);
    expect(
      existsSync(
        workspacePath(".agents", "skills", "libretto-readonly", "stale.txt"),
      ),
    ).toBe(false);
  });

  test("prints usage for --help", async ({ librettoCli }) => {
    const result = await librettoCli("--help");
    expect(result.stdout).toBe(expectedRootHelp());
    expect(result.stderr).toBe("");
  });

  test("prints usage for -h", async ({ librettoCli }) => {
    const result = await librettoCli("-h");
    expect(result.stdout).toBe(expectedRootHelp());
    expect(result.stderr).toBe("");
  });

  test("prints usage for help command", async ({ librettoCli }) => {
    const result = await librettoCli("help");
    expect(result.stdout).toBe(expectedRootHelp());
    expect(result.stderr).toBe("");
  });

  test("prints package version", async ({ librettoCli }) => {
    const cliVersion = await readCliVersion();

    await expect(librettoCli("--version")).resolves.toMatchObject({
      stdout: `${cliVersion}\n`,
      stderr: "",
    });
    await expect(librettoCli("-v")).resolves.toMatchObject({
      stdout: `${cliVersion}\n`,
      stderr: "",
    });
  });

  test("prints scoped help for status command", async ({ librettoCli }) => {
    const result = await librettoCli("help status");
    expect(result.stdout).toContain("Show workspace status");
    expect(result.stdout).toContain("open sessions");
    expect(result.stderr).toBe("");
  });

  test("prints scoped help for update command", async ({ librettoCli }) => {
    const result = await librettoCli("help update");
    expect(result.stdout).toContain("Update Libretto to the latest version");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stderr).toBe("");
  });

  test("update dry-run prints the local package update command", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("update --dry-run");
    expect(result.stdout).toContain("Update command:");
    expect(result.stdout).toContain("npm install libretto@latest");
    expect(result.stdout).toContain("No changes made.");
    expect(result.stderr).toBe("");
  });

  test("update dry-run uses the project package manager", async ({
    librettoCli,
    workspacePath,
  }) => {
    await writeFile(workspacePath("pnpm-lock.yaml"), "", "utf8");

    const result = await librettoCli("update --dry-run");

    expect(result.stdout).toContain("Update command:");
    expect(result.stdout).toContain("pnpm add libretto@latest");
    expect(result.stdout).toContain("No changes made.");
    expect(result.stderr).toBe("");
  });

  test("update skips package install when already on the latest version", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedLocalLibrettoPackageVersion(workspacePath, cliVersion);
    const binDir = workspacePath("bin");
    await mkdir(binDir, { recursive: true });
    const npmPath = workspacePath("bin", "npm");
    await writeFile(
      npmPath,
      `#!/usr/bin/env bash\nprintf '%s\\n' '${cliVersion}'\n`,
      "utf8",
    );
    await chmod(npmPath, 0o755);

    const result = await librettoCli("update", {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(result.stdout).toContain(`Current version: ${cliVersion}`);
    expect(result.stdout).toContain(`Latest version: ${cliVersion}`);
    expect(result.stdout).toContain("Libretto is already up to date");
    expect(result.stdout).toContain("No further action required.");
    expect(result.stdout).not.toContain(
      "Updating local Libretto package to latest",
    );
    expect(result.stderr).toBe("");
  });

  test("prints cloud group help with hosted commands", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help cloud");
    expect(result.stdout).toContain(
      "Deploy workflows and manage hosted Libretto",
    );
    expect(result.stdout).toContain(
      "libretto cloud <subcommand>",
    );
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("auth");
    expect(result.stdout).toContain("billing");
    expect(result.stdout).toContain("jobs");
    expect(result.stdout).toContain("schedules");
    expect(result.stdout).toContain("settings");
    expect(result.stdout).toContain("share");
    expect(result.stdout).toContain("sharing");
    expect(result.stderr).toBe("");
  });

  test("prints cloud jobs create help", async ({ librettoCli }) => {
    const result = await librettoCli("help cloud jobs create");
    expect(result.stdout).toContain(
      "Create a Libretto Cloud job for a deployed workflow",
    );
    expect(result.stdout).toContain("libretto cloud jobs create [workflow]");
    expect(result.stdout).toContain("--params-file");
    expect(result.stdout).toContain("--timeout-seconds");
    expect(result.stderr).toBe("");
  });

  test("cloud jobs create requires an API key", async ({ librettoCli }) => {
    const result = await librettoCli("cloud jobs create testWorkflow", {
      LIBRETTO_API_KEY: undefined,
    });

    expect(result.stderr).toContain(
      "LIBRETTO_API_KEY is required to create Libretto Cloud jobs.",
    );
    expect(result.stderr).toContain("libretto cloud auth api-key issue");
  });

  test("prints cloud schedules create help", async ({ librettoCli }) => {
    const result = await librettoCli("help cloud schedules create");
    expect(result.stdout).toContain(
      "Create a recurring schedule for a deployed workflow",
    );
    expect(result.stdout).toContain(
      "libretto cloud schedules create [workflow]",
    );
    expect(result.stdout).toContain("--cron");
    expect(result.stdout).toContain("--timezone");
    expect(result.stderr).toBe("");
  });

  test("cloud schedules create requires an API key", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(
      'cloud schedules create testWorkflow --cron "0 * * * *"',
      { LIBRETTO_API_KEY: undefined },
    );

    expect(result.stderr).toContain(
      "LIBRETTO_API_KEY is required to create Libretto Cloud schedules.",
    );
    expect(result.stderr).toContain("libretto cloud auth api-key issue");
  });

  test("prints cloud share help", async ({ librettoCli }) => {
    const result = await librettoCli("help cloud share");
    expect(result.stdout).toContain("Share one hosted workflow's code publicly");
    expect(result.stdout).toContain("libretto cloud share <workflow>");
    expect(result.stdout).toContain("--refresh");
    expect(result.stderr).toBe("");
  });

  test("cloud share requires an API key", async ({ librettoCli }) => {
    const result = await librettoCli("cloud share testWorkflow", {
      LIBRETTO_API_KEY: undefined,
    });

    expect(result.stderr).toContain(
      "LIBRETTO_API_KEY is required to share Libretto Cloud workflow code.",
    );
    expect(result.stderr).toContain("libretto cloud auth api-key issue");
  });

  test("prints deploy help with auto repair flag", async ({ librettoCli }) => {
    const result = await librettoCli("help cloud deploy", {
      npm_command: undefined,
      npm_config_user_agent: undefined,
    });
    expect(result.stdout).toContain(
      "Deploy workflows to the hosted platform",
    );
    expect(result.stdout).toContain("libretto cloud deploy [sourceDir]");
    expect(result.stdout).toContain("--auto-repair");
    expect(result.stdout).toContain(
      "Route failed jobs for this deployment to autofix",
    );
    expect(result.stderr).toBe("");
  });

  test("deploy requires an API key and points users to signup", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const result = await librettoCli("cloud deploy .", {
      HOME: workspaceDir,
      LIBRETTO_API_KEY: undefined,
    });

    expect(result.stderr).toContain(
      "LIBRETTO_API_KEY is required to deploy to Libretto Cloud.",
    );
    expect(result.stderr).toContain("libretto cloud auth signup");
    expect(result.stderr).toContain("libretto cloud auth login");
    expect(result.stderr).toContain("libretto cloud auth api-key issue");
    expect(result.stderr).toContain("LIBRETTO_API_KEY=<issued-key>");
    expect(result.stderr).toContain(".env");
    expect(result.stdout).not.toContain("Bundling hosted deployment artifact");
  });

  test("deploy requires only API key setup when already logged in", async ({
    librettoCli,
    workspaceDir,
    workspacePath,
  }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    await writeFile(
      workspacePath(".libretto", "auth.json"),
      JSON.stringify({
        apiUrl: "https://api.libretto.sh",
        session: {
          cookie: "better-auth.session_token=test-session",
          userId: "user-test",
          email: "user@example.com",
          expiresAt: null,
        },
      }),
      "utf8",
    );

    const result = await librettoCli("cloud deploy .", {
      HOME: workspaceDir,
      LIBRETTO_API_KEY: undefined,
    });

    expect(result.stderr).toContain(
      "You are logged in locally, but deploy endpoints require API-key auth.",
    );
    expect(result.stderr).toContain("libretto cloud auth api-key issue");
    expect(result.stderr).toContain("LIBRETTO_API_KEY=<issued-key>");
    expect(result.stderr).not.toContain("libretto cloud auth signup");
    expect(result.stderr).not.toContain("libretto cloud auth login");
    expect(result.stdout).not.toContain("Bundling hosted deployment artifact");
  });

  test("deploy with API key ignores broken local auth state", async ({
    librettoCli,
    workspaceDir,
    workspacePath,
  }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    await writeFile(workspacePath(".libretto", "auth.json"), "{broken", "utf8");

    const result = await librettoCli("cloud deploy .", {
      HOME: workspaceDir,
      LIBRETTO_API_KEY: "test-key",
    });

    expect(result.stderr).toContain("No package.json found");
    expect(result.stderr).not.toContain("LIBRETTO_API_KEY is required");
    expect(result.stderr).not.toContain("auth.json");
  });

  test("prints run help with explicit visualization disable flag", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help run");
    expect(result.stdout).toContain(
      "Run the default-exported Libretto workflow from a file",
    );
    expect(result.stdout).toContain(
      "libretto run [integrationFile] [options]",
    );
    expect(result.stdout).toContain("--read-only");
    expect(result.stdout).toContain("--no-visualize");
    expect(result.stdout).toContain("--stay-open-on-success");
    expect(result.stdout).toContain(
      "Disable ghost cursor + highlight visualization in headed mode",
    );
    expect(result.stderr).toBe("");
  });

  test("prints session-mode help", async ({ librettoCli }) => {
    const result = await librettoCli("help session-mode");
    expect(result.stdout).toContain("View or set the session access mode");
    expect(result.stdout).toContain(
      "libretto session-mode [mode] [options]",
    );
    expect(result.stderr).toBe("");
  });

  test("prints experiments help", async ({ librettoCli }) => {
    const result = await librettoCli("help experiments");
    expect(result.stdout).toContain("List or update Libretto experiment flags");
    expect(result.stdout).toContain(
      "libretto experiments [action] [experiment]",
    );
    expect(result.stdout).toContain("Action to apply");
    expect(result.stdout).toContain("Experiment name");
    expect(result.stderr).toBe("");
  });

  test("experiments reports registered experiment status", async ({
    librettoCli,
  }) => {
    const initial = await librettoCli("experiments");
    expect(initial.stdout).toContain("Libretto experiments:");
    expect(initial.stdout).toContain("search: disabled");
    expect(initial.stderr).toBe("");
  });

  test("search points users to its experiment flag when disabled", async ({
    librettoCli,
    seedSessionState,
  }) => {
    const session = "search-disabled";
    await seedSessionState({ session });

    const result = await librettoCli(`search Needle --session ${session}`);
    expect(result.stderr).toContain('The "search" experiment is disabled.');
    expect(result.stderr).toContain("libretto experiments enable search");
  });

  test("experiments rejects missing and unknown experiment names with usage", async ({
    librettoCli,
  }) => {
    const missing = await librettoCli("experiments enable");
    expect(missing.stderr).toContain("Missing experiment name for enable.");
    expect(missing.stderr).toContain("libretto experiments");
    expect(missing.stderr).toContain("libretto experiments enable <experiment>");

    const unknownAction = await librettoCli(
      "experiments toggle oldExperiment",
    );
    expect(unknownAction.stderr).toContain(
      'Unknown experiments action "toggle".',
    );
    expect(unknownAction.stderr).toContain("libretto experiments");
    expect(unknownAction.stderr).toContain(
      "libretto experiments enable <experiment>",
    );

    const unknown = await librettoCli("experiments enable nopeExperiment");
    expect(unknown.stderr).toContain('Unknown experiment "nopeExperiment".');
    expect(unknown.stderr).toContain("libretto experiments");
    expect(unknown.stderr).toContain("libretto experiments enable <experiment>");
  });

  test("run does not expose experiments to workflow context", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-experiment-context.mjs",
      `
export default workflow("main", async (ctx) => {
  console.log("EXPERIMENTS_CONTEXT_TYPE", typeof ctx.experiments);
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session experiment-context-test --headless`,
    );
    expect(result.stdout).toContain("EXPERIMENTS_CONTEXT_TYPE undefined");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stderr).toBe("");
  }, 45_000);

  test("fails unknown command with a clear error", async ({ librettoCli }) => {
    const result = await librettoCli("nope-command");
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain("libretto <command>");
  });

  test("fails unknown group command with scoped help", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("cloud opne");
    expect(result.stderr).toContain("Unknown command: cloud opne");
    expect(result.stderr).toContain(
      "Deploy workflows and manage hosted Libretto",
    );
    expect(result.stderr).toContain("Usage: libretto cloud <subcommand>");
    expect(result.stderr).toContain(
      "deploy  Deploy workflows to the hosted platform",
    );
    expect(result.stderr).toContain(
      "auth <subcommand>  Hosted-platform auth commands",
    );
    expect(result.stderr).toContain(
      "jobs <subcommand>  Create and manage hosted jobs",
    );
    expect(result.stderr).toContain(
      "schedules <subcommand>  Create and manage hosted schedules",
    );
    expect(result.stderr).toContain(
      "settings <subcommand>  Manage Libretto Cloud tenant settings",
    );
    expect(result.stderr).not.toContain("Usage: libretto <command>");
    expect(result.stdout).toBe("");
  });

  test("open help shows url is optional", async ({ librettoCli }) => {
    const result = await librettoCli("open --help");
    expect(result.stdout).toContain("open [url] [options]");
    expect(result.stdout).toContain("URL to open (defaults to about:blank)");
  });

  test("session-mode prints and updates the current session mode", async ({
    librettoCli,
    seedSessionState,
  }) => {
    const session = "session-mode-cli";
    await seedSessionState({ session, mode: "write-access" });

    const currentMode = await librettoCli(
      `session-mode --session ${session}`,
    );
    expect(currentMode.stdout).toContain(
      `Session "${session}" mode: write-access`,
    );

    const setMode = await librettoCli(
      `session-mode read-only --session ${session}`,
    );
    expect(setMode.stdout).toContain(
      `Session "${session}" mode set to read-only.`,
    );

    const updatedMode = await librettoCli(
      `session-mode --session ${session}`,
    );
    expect(updatedMode.stdout).toContain(
      `Session "${session}" mode: read-only`,
    );
  });

  test("opens file URLs", async ({ librettoCli, workspacePath }) => {
    const htmlPath = workspacePath("fixtures", "local-file.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await mkdir(workspacePath(".libretto", "profiles"), { recursive: true });
    await writeFile(
      htmlPath,
      `<!doctype html><html><head><title>Local File Title</title></head><body><h1>Local File Body</h1></body></html>`,
      "utf8",
    );
    await writeFile(
      workspacePath(".libretto", "profiles", "local-file.json"),
      "{ definitely-not-valid-json}",
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    const session = "file-url-open";

    const opened = await librettoCli(
      `open "${fileUrl}" --headless --session ${session}`,
    );
    expect(opened.stderr).toBe("");
    expect(opened.stdout).toContain(`Browser open (headless): ${fileUrl}`);
    expect(opened.stdout).not.toContain("Loading saved profile");

    const title = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(title.stderr).toBe("");
    expect(title.stdout).toContain("Local File Title");

    const closed = await librettoCli(`close --session ${session}`);
    expect(closed.stderr).toBe("");
    expect(closed.stdout).toContain(`Browser closed (session: ${session}).`);
  }, 45_000);

  test("fails open with actionable error when browser child spawn fails", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open https://example.com", {
      PLAYWRIGHT_BROWSERS_PATH: "/definitely-not-real",
    });
    expect(result.stderr).toContain("Daemon exited before startup");
    expect(result.stderr).toContain("Check logs:");
  });

  test("warns on open when the installed skill version is out of date", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", "0.0.0");

    const result = await librettoCli("open https://example.com", {
      npm_config_user_agent: "bun/1.0.0",
      PLAYWRIGHT_BROWSERS_PATH: "/definitely-not-real",
    });

    expectVersionWarningHeader(result.stderr);
    expect(result.stderr).toContain(
      `local package: ${cliVersion}  (current command)`,
    );
    expect(result.stderr).toContain("agent skill:   0.0.0");
    expectNoPackageUpdateCommand(result.stderr);
    expectSkillSetupCommand(result.stderr);
    expect(result.stderr).toContain("Daemon exited before startup");
  });

  test("does not warn when only the current command differs from the local package", async ({
    librettoCli,
    workspacePath,
  }) => {
    await seedLocalLibrettoPackageVersion(workspacePath, "0.0.0");

    const result = await librettoCli("connect not-a-url --session local");

    expect(result.stderr).not.toContain(
      "WARNING: Libretto skill version does not match the local package.",
    );
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("warns when the installed skill does not match the local libretto package", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedLocalLibrettoPackageVersion(workspacePath, "0.0.0");
    await seedInstalledSkillVersion(workspacePath, ".agents", cliVersion);

    const result = await librettoCli("connect not-a-url --session skill-local");

    expectVersionWarningHeader(result.stderr);
    expect(result.stderr).toContain("local package: 0.0.0");
    expect(result.stderr).toContain(`agent skill:   ${cliVersion}`);
    expectNoPackageUpdateCommand(result.stderr);
    expectSkillSetupCommand(result.stderr);
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("version warning does not suggest package updates", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await writeFile(workspacePath("pnpm-lock.yaml"), "", "utf8");
    await seedLocalLibrettoPackageVersion(workspacePath, "0.0.0");
    await seedInstalledSkillVersion(workspacePath, ".agents", cliVersion);

    const result = await librettoCli("connect not-a-url --session pnpm-local");

    expectVersionWarningHeader(result.stderr);
    expect(result.stderr).toContain("local package: 0.0.0");
    expect(result.stderr).toContain(`agent skill:   ${cliVersion}`);
    expectNoPackageUpdateCommand(result.stderr);
    expectSkillSetupCommand(result.stderr);
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("does not warn when the local package and installed skill match", async ({
    librettoCli,
    workspacePath,
  }) => {
    const projectVersion = "9.9.9";
    await seedLocalLibrettoPackageVersion(workspacePath, projectVersion);
    await seedInstalledSkillVersion(workspacePath, ".agents", projectVersion);

    const result = await librettoCli("connect not-a-url --session local-match");

    expect(result.stderr).not.toContain(
      "WARNING: Libretto skill version does not match the local package.",
    );
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("defaults sessioned browser commands to the default session", async ({
    librettoCli,
  }) => {
    const opened = await librettoCli("open https://example.com --headless");
    expect(opened.stdout).toContain("Browser open");
    expect(opened.stdout).toContain("example.com");
    expect(opened.stderr).toBe("");
    const session = requireReturnedSessionId(
      "open",
      opened.stdout,
      opened.stderr,
    );

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("Open pages:");
    expect(pages.stdout).toContain("example.com");
    expect(pages.stderr).toBe("");

    const close = await librettoCli(`close --session ${session}`);
    expect(close.stdout).toContain(`Browser closed (session: ${session}).`);
    expect(close.stderr).toBe("");
  }, 45_000);

  test("fails exec with missing code usage error", async ({ librettoCli }) => {
    const result = await librettoCli("exec --session test");
    expect(result.stderr).toContain(
      "libretto exec <code|-> [--session <name>] [--visualize]",
    );
  });

  test("fails exec with missing code usage error when only flags are passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("exec --visualize --session test");
    expect(result.stderr).toContain(
      "libretto exec <code|-> [--session <name>] [--visualize]",
    );
    expect(result.stderr).not.toContain(
      `Missing required --session for "exec".`,
    );
  });

  test("fails readonly-exec with missing code usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("readonly-exec --session test");
    expect(result.stderr).toContain(
      "libretto readonly-exec <code|-> [--session <name>] [--page <id>]",
    );
  });

  test("exec with hyphen requires stdin input", async ({ librettoCli }) => {
    const session = "exec-stdin-requires-input";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const result = await librettoCli(`exec - --session ${session}`);
    expect(result.stderr).toContain("Missing stdin input for `exec -`.");
  });

  test("exec with hyphen executes code piped through stdin", async ({
    librettoCli,
  }) => {
    const session = "exec-stdin-with-input";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const result = await librettoCli(
      `exec - --session ${session}`,
      undefined,
      "1;",
    );
    expect(result.stdout).toContain("1");
    expect(result.stderr).toBe("");
  });

  test("fails run when integration file does not exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("Integration file does not exist:");
    expect(result.stderr).toContain("integration.ts");
  });

  test("warns on run when the installed skill version is out of date", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".claude", "0.0.0");

    const result = await librettoCli("run ./integration.ts");

    expectVersionWarningHeader(result.stderr);
    expect(result.stderr).toContain(
      `local package: ${cliVersion}  (current command)`,
    );
    expect(result.stderr).toContain("agent skill:   0.0.0");
    expectNoPackageUpdateCommand(result.stderr);
    expectSkillSetupCommand(result.stderr);
    expect(result.stderr).toContain("Integration file does not exist:");
  });

  test("warns on connect when the installed skill version is out of date", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", "0.0.0");

    const result = await librettoCli("connect not-a-url --session mismatch");

    expectVersionWarningHeader(result.stderr);
    expect(result.stderr).toContain(
      `local package: ${cliVersion}  (current command)`,
    );
    expect(result.stderr).toContain("agent skill:   0.0.0");
    expectNoPackageUpdateCommand(result.stderr);
    expectSkillSetupCommand(result.stderr);
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("does not warn when the installed skill version matches the CLI", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", cliVersion);

    const result = await librettoCli("connect not-a-url --session matching");

    expect(result.stderr).not.toContain(
      "WARNING: Libretto skill version does not match the local package.",
    );
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("fails run with invalid JSON in --params", async ({ librettoCli }) => {
    const result = await librettoCli('run ./integration.ts --params "{not-json}"');
    expect(result.stderr).toContain("Invalid JSON in --params:");
  });

  test("validates workflow params before starting a browser session", async ({
    librettoCli,
    librettoRuntimePath,
    writeWorkflowScript,
  }) => {
    await writeWorkflowScript(
      "integration.ts",
      outdent`
        import { workflow } from "${librettoRuntimePath}";
        import { z } from "zod";

        export default workflow(
          "main",
          {
            input: z.object({ url: z.string().url() }),
            output: z.unknown(),
          },
          async () => "ok",
        );
      `,
    );

    const result = await librettoCli(
      `run ./integration.ts --session validation-preflight --params '{"url":"not-url"}'`,
    );
    expect(result.stderr).toContain('Invalid input for workflow "main"');
    expect(result.stderr).not.toContain("Browser is still open");
    expect(result.stdout).not.toContain("Running workflow");

    const pagesResult = await librettoCli("pages --session validation-preflight");
    expectMissingSessionError(pagesResult.stderr, "validation-preflight");
  });

  test("fails fast for invalid session names before command execution", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(
      "open https://example.com --session ../bad-name",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Invalid session name. Use only letters, numbers, dots, underscores, and dashes.",
    );
  });

  test("fails for invalid inline session names", async ({ librettoCli }) => {
    const result = await librettoCli(
      "open https://example.com --session=../bad-name",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Invalid session name. Use only letters, numbers, dots, underscores, and dashes.",
    );
  });

  test("accepts hyphen-prefixed session values", async ({ librettoCli }) => {
    const result = await librettoCli("pages --session -dash");
    expectMissingSessionError(result.stderr, "-dash");
    expect(result.stderr).not.toContain("Missing value for --session.");
  });

  test("fails run with invalid JSON in --params-file", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "invalid-params.json");
    await writeFile(paramsPath, "{not-json}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts --params-file "${paramsPath}"`,
    );
    expect(result.stderr).toContain("Invalid JSON in --params-file:");
  });

  test("fails run when --params and --params-file are both provided", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "params.json");
    await writeFile(paramsPath, "{}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts --params "{}" --params-file "${paramsPath}"`,
    );
    expect(result.stderr).toContain(
      "Pass either --params or --params-file, not both.",
    );
  });

  test("fails run with stable error when --params-file is missing", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const missingPath = join(workspaceDir, "missing-params.json");

    const result = await librettoCli(
      `run ./integration.ts --params-file "${missingPath}"`,
    );
    expect(result.stderr).toContain(
      `Could not read --params-file "${missingPath}". Ensure the file exists and is readable.`,
    );
  });

  test("fails run when the file does not default-export a workflow", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export async function main() {
  return "ok";
}
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
  });

  test("run uses a default-exported workflow", async ({
    librettoCli,
    workspaceDir,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
const main = workflow("main", async () => {
  return "ok";
});

export default main;
`,
    );

    const result = await librettoCli("run ./integration.ts", {
      PLAYWRIGHT_BROWSERS_PATH: join(
        workspaceDir,
        "missing-playwright-browsers",
      ),
    });
    expect(result.stderr).not.toContain("No default-exported workflow found");
  });

  test("run fails when the workflow is exported only as a named export", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const testWorkflow = workflow("test", async () => {
  return "ok";
});
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
    expect(result.stderr).toContain("Available named workflows: test");
  });

  test("run fails when a file defines workflows without a default export", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const first = workflow("first", async () => {
  return "ok";
});

export const second = workflow("second", async () => {
  return "ok";
});
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
    expect(result.stderr).toContain("Available named workflows: first, second");
  });

  test("run forwards --tsconfig to tsx for workflow imports", async ({
    librettoCli,
    workspacePath,
    writeWorkflow,
  }) => {
    await mkdir(workspacePath("feature", "src"), { recursive: true });
    await writeFile(
      workspacePath("feature", "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["src/*"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      workspacePath("feature", "src", "message.ts"),
      'export default "TSCONFIG_ALIAS_OK";\n',
      "utf8",
    );
    const integrationFilePath = await writeWorkflow(
      "feature/integration.ts",
      `
import message from "@/message";

export default workflow("main", async () => {
  console.log(message);
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --tsconfig "${workspacePath("feature", "tsconfig.json")}" --session tsconfig-test --headless`,
    );
    expect(result.stdout).toContain("TSCONFIG_ALIAS_OK");
    expect(result.stdout).toContain("Integration completed.");
  }, 45_000);

  test("run compile failures mention --tsconfig guidance", async ({
    librettoCli,
    workspacePath,
  }) => {
    await writeFile(
      workspacePath("integration-compile-error.ts"),
      "const = 1;\n",
      "utf8",
    );
    const result = await librettoCli(
      'run "./integration-compile-error.ts" --session compile-test --headless',
    );
    expect(result.stderr).toContain("--tsconfig <path>");
    expect(result.stderr).toMatch(/failed|error|transform/i);
    expect(result.stderr).not.toContain("Browser is still open.");
    expect(result.stderr).not.toContain("use `exec` to inspect it");
  }, 45_000);

  test("fails run when a workflow is exported directly but not as default", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const main = workflow("main", async () => {
  return "ok";
});
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
    expect(result.stderr).toContain("Available named workflows: main");
  });

  test("fails run when workflows are exported only through a manifest", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
const main = workflow("main", async () => {
  return "ok";
});

export const workflows = {
  [main.name]: main,
};
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
    expect(result.stderr).toContain("Available named workflows: main");
  });

  test("fails run when workflows binding is the only export", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const workflows = workflow("main", async () => {
  return "ok";
});
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain("No default-exported workflow found");
    expect(result.stderr).toContain("Available named workflows: main");
  });

  test("fails run when local auth profile is declared but missing", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export default workflow("main", {
  authProfile: "app.example.com",
  async handler() {
    return "ok";
  },
});
`,
    );

    const result = await librettoCli("run ./integration.ts");
    expect(result.stderr).toContain(
      'Local auth profile not found: "app.example.com".',
    );
    expect(result.stderr).toContain("libretto open <site-url> --headed --session");
    expect(result.stderr).toContain(
      "libretto save app.example.com --session",
    );
    expect(result.stderr).toContain("--sites <site>");
  });

  test("does not require local auth profile when auth metadata is absent", async ({
    librettoCli,
    workspaceDir,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export default workflow("main", async () => "ok");
`,
    );

    const result = await librettoCli("run ./integration.ts", {
      PLAYWRIGHT_BROWSERS_PATH: join(
        workspaceDir,
        "missing-playwright-browsers",
      ),
    });
    expect(result.stderr).not.toContain("No local auth profile found");
  });

  test("returns paused status when workflow pauses with ctx.session", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "pause-from-workflow-context";
    const integrationFilePath = await writeWorkflow(
      "integration-pause.mjs",
      `
export default workflow("main", async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await pause(ctx.session);
  console.log("WORKFLOW_AFTER_PAUSE");
});
`,
      ["workflow", "pause"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(result.stdout).toContain("WORKFLOW_BEFORE_PAUSE");
    expect(result.stdout).toContain("Workflow paused.");
    expect(result.stdout).not.toContain("WORKFLOW_AFTER_PAUSE");
    expect(result.stdout).not.toContain("Integration completed.");
  }, 45_000);

  test("resume remains allowed after a paused session is relocked to read-only", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "pause-readonly-resume";
    const integrationFilePath = await writeWorkflow(
      "integration-pause-readonly-resume.mjs",
      `
let resumedOnce = false;

export default workflow("main", async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  if (!resumedOnce) {
    resumedOnce = true;
    await pause(ctx.session);
  }
  console.log("WORKFLOW_AFTER_RESUME");
});
`,
      ["workflow", "pause"],
    );

    const paused = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --read-only`,
    );
    expect(paused.stdout).toContain("WORKFLOW_BEFORE_PAUSE");
    expect(paused.stdout).toContain("Workflow paused.");

    const resumed = await librettoCli(`resume --session ${session}`);
    expect(resumed.stdout).toContain(`Resume requested for session "${session}".`);
    expect(resumed.stdout).toContain("WORKFLOW_AFTER_RESUME");
    expect(resumed.stdout).toContain("Integration completed.");
    expect(resumed.stdout).toContain("Browser closed");
    expect(resumed.stderr).toBe("");

    const pages = await librettoCli(`pages --session ${session}`);
    expectMissingSessionError(pages.stderr, session);
  }, 45_000);

  test("resume waits for a second pause before completing on the next resume", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "pause-twice-resume";
    const integrationFilePath = await writeWorkflow(
      "integration-pause-twice-resume.mjs",
      `
export default workflow("main", async (ctx) => {
  console.log("WORKFLOW_BEFORE_FIRST_PAUSE");
  await pause(ctx.session);
  console.log("WORKFLOW_BEFORE_SECOND_PAUSE");
  await pause(ctx.session);
  console.log("WORKFLOW_AFTER_SECOND_RESUME");
});
`,
      ["workflow", "pause"],
    );

    const paused = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(paused.stdout).toContain("WORKFLOW_BEFORE_FIRST_PAUSE");
    expect(paused.stdout).toContain("Workflow paused.");
    expect(paused.stdout).not.toContain("WORKFLOW_BEFORE_SECOND_PAUSE");
    expect(paused.stdout).not.toContain("Integration completed.");

    const pausedAgain = await librettoCli(`resume --session ${session}`);
    expect(pausedAgain.stdout).toContain("WORKFLOW_BEFORE_SECOND_PAUSE");
    expect(pausedAgain.stdout).toContain("Workflow paused.");
    expect(pausedAgain.stdout).not.toContain("WORKFLOW_AFTER_SECOND_RESUME");
    expect(pausedAgain.stdout).not.toContain("Integration completed.");

    const completed = await librettoCli(`resume --session ${session}`);
    expect(completed.stdout).toContain("WORKFLOW_AFTER_SECOND_RESUME");
    expect(completed.stdout).toContain("Integration completed.");
    expect(completed.stdout).toContain("Browser closed");
    expect(completed.stderr).toBe("");
  }, 45_000);

  test("resume keeps browser open after paused stay-open run completes", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "pause-stay-open-resume";
    const integrationFilePath = await writeWorkflow(
      "integration-pause-stay-open-resume.mjs",
      `
let resumedOnce = false;

export default workflow("main", async (ctx) => {
  await ctx.page.goto("data:text/html,<title>Resume Stay Open</title>");
  console.log("WORKFLOW_BEFORE_STAY_OPEN_PAUSE");
  if (!resumedOnce) {
    resumedOnce = true;
    await pause(ctx.session);
  }
  console.log("WORKFLOW_AFTER_STAY_OPEN_RESUME");
});
`,
      ["workflow", "pause"],
    );

    const paused = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(paused.stdout).toContain("WORKFLOW_BEFORE_STAY_OPEN_PAUSE");
    expect(paused.stdout).toContain("Workflow paused.");

    const resumed = await librettoCli(`resume --session ${session}`);
    expect(resumed.stdout).toContain("WORKFLOW_AFTER_STAY_OPEN_RESUME");
    expect(resumed.stdout).toContain("Integration completed.");
    expect(resumed.stdout).toContain("Browser is still open");

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("Open pages:");
  }, 45_000);

  test("pause reports ctx.session guidance when session id is missing", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-pause-missing-session.mjs",
      `
export default workflow("main", async () => {
  await pause("");
});
`,
      ["workflow", "pause"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session pause-test --headless`,
    );
    expect(result.stderr).toContain(
      "pause(session) requires a non-empty session ID.",
    );
    expect(result.stderr).toContain("pause(ctx.session)");
    expect(result.stderr).toContain("libretto status");
  }, 45_000);

  test("pause reports workflow runtime guidance outside an active workflow", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-pause-outside-runtime.mjs",
      `
await pause("outside-runtime");

export default workflow("main", async () => {});
`,
      ["workflow", "pause"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session pause-outside-runtime --headless`,
    );
    expect(result.stderr).toContain(
      "pause(session) can only suspend an active Libretto workflow.",
    );
    expect(result.stderr).toContain("libretto run <integrationFile>");
    expect(result.stderr).toContain("pause(ctx.session)");
  }, 45_000);

  test("completes workflow run when no pause is triggered", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-complete.mjs",
      `
export default workflow("main", async () => {
  console.log("WORKFLOW_COMPLETES");
  console.error("WORKFLOW_STDERR_COMPLETES");
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session complete-test --headless`,
    );
    expect(result.stdout).toContain("WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stderr).toContain("WORKFLOW_STDERR_COMPLETES");
    expect(result.stdout).not.toContain("Workflow paused.");
  }, 45_000);

  test("run applies recoveryAction before retrying a failed browser action", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-recovery-action.mjs",
      `
const main = workflow("main", {
  recoveryAction: async ({ page }) => {
    console.log("RECOVERY_ACTION_RAN");
    await page.locator("#modal").evaluate((node) => node.remove());
  },
  handler: async ({ page }) => {
    await page.setContent(\`
      <style>
        #target {
          margin: 80px;
          width: 180px;
          height: 64px;
        }
        #modal {
          position: fixed;
          inset: 0;
          z-index: 10;
          background: rgba(0, 0, 0, 0.3);
        }
      </style>
      <button id="target">Click target</button>
      <div id="modal"></div>
      <script>
        document.querySelector("#target").addEventListener("click", () => {
          document.body.dataset.clicked = "true";
        });
      </script>
    \`);
    page.setDefaultTimeout(250);
    await page.locator("#target").click();
    console.log("RECOVERY_CLICKED=" + await page.locator("body").getAttribute("data-clicked"));
  },
});

export default main;
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session recovery-action-test --headless`,
    );
    expect(result.stdout).toContain("RECOVERY_ACTION_RAN");
    expect(result.stdout).toContain("RECOVERY_CLICKED=true");
    expect(result.stdout).toContain("Integration completed.");
  }, 45_000);

  test("run closes completed sessions by default", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "complete-default-closes";
    const integrationFilePath = await writeWorkflow(
      "integration-complete-closes.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Default Close</title>");
  console.log("DEFAULT_CLOSE_WORKFLOW_COMPLETES");
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(result.stdout).toContain("DEFAULT_CLOSE_WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("Browser closed");

    const pages = await librettoCli(`pages --session ${session}`);
    expectMissingSessionError(pages.stderr, session);
  }, 45_000);

  test("run --stay-open-on-success keeps completed session available for inspection", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "stay-open-success-test";
    const integrationFilePath = await writeWorkflow(
      "integration-stay-open-success.mjs",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("data:text/html,<title>Stay Open Success</title>");
  console.log("STAY_OPEN_WORKFLOW_COMPLETES");
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --stay-open-on-success`,
    );
    expect(result.stdout).toContain("STAY_OPEN_WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).toContain("Browser is still open");

    const inspected = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(inspected.stdout).toContain("Stay Open Success");
  }, 45_000);

  test("run succeeds with page.evaluate callbacks containing nested helpers (tsx __name shim)", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-evaluate-nested.ts",
      `
export default workflow("main", async ({ page }) => {
  await page.goto("https://example.com");
  const value = await page.evaluate(async () => {
    const normalize = (input: string | null | undefined) => input?.trim() ?? null;
    const parseNumberLike = (input: unknown) =>
      Number(String(input).replace(/[^\\d.]/g, ""));
    return { text: normalize(" x "), num: parseNumberLike("12") };
  });
  console.log("EVAL_RESULT", JSON.stringify(value));
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session evaluate-nested-test --headless`,
    );
    expect(result.stderr).not.toContain("__name is not defined");
    expect(result.stdout).toContain("EVAL_RESULT");
    expect(result.stdout).toContain('"text":"x"');
    expect(result.stdout).toContain('"num":12');
    expect(result.stdout).toContain("Integration completed.");
  }, 45_000);

  test("run prints failure guidance and keeps browser open for exec inspection", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "debug-selector-error-guidance";
    const integrationFilePath = await writeWorkflow(
      "integration-selector-error-debug.mjs",
      `
export default workflow("main", async (ctx) => {
  await ctx.page.goto("https://example.com");
  const debugPage = await ctx.page.context().newPage();
  await debugPage.goto("data:text/html,<title>Debug Target</title>");
  await ctx.page.locator("[").click();
});
`,
    );

    const runResult = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(runResult.stderr).toContain("locator.click:");
    expect(runResult.stderr).toContain("Browser is still open.");
    expect(runResult.stderr).toContain("use `exec` to inspect it");
    expect(runResult.stderr).toContain("Call `run` to re-run the workflow.");

    const execResult = await librettoCli(
      `exec "await page.title()" --session ${session}`,
    );
    expect(execResult.stdout).toMatch(/Example Domain|Debug Target/);

    const rerunResult = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless`,
    );
    expect(rerunResult.stderr).toContain("locator.click:");
    expect(rerunResult.stderr).toContain("Browser is still open.");
    expect(rerunResult.stderr).toContain("use `exec` to inspect it");
    expect(rerunResult.stderr).toContain("Call `run` to re-run the workflow.");
    expect(rerunResult.stderr).not.toContain(
      "is already open and connected to",
    );
  }, 60_000);

  test("fails save with missing target usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("save --session test");
    expect(result.stderr).toContain("Missing required argument <profileName>.");
  });

  test("fails when --session value is missing", async ({ librettoCli }) => {
    const result = await librettoCli(`exec "return 1" --session`);
    expect(result.stderr).toContain("Missing value for --session.");
  });

  test("allows session names that match command tokens", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("pages --session open");
    expect(result.stdout).toBe("");
    expectMissingSessionError(result.stderr, "open");
  });
});
