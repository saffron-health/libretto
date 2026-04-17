import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

function expectedSkillVersionWarning(
  skillVersion: string,
  cliVersion: string,
): string {
  return `Warning: Your agent skill (${skillVersion}) is out of date with your Libretto CLI (${cliVersion}). Please run \`npx libretto setup\` to update your skills to the correct version.`;
}

describe("basic CLI subprocess behavior", () => {
  test("setup explains snapshot API env setup when no credentials are configured", async ({
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

    expect(result.stdout).toContain("sub-agent to analyze DOM snapshots");
    expect(result.stdout).toContain("No snapshot API credentials detected.");
    expect(result.stdout).toContain("OPENAI_API_KEY=...");
    expect(result.stdout).toContain("ANTHROPIC_API_KEY=...");
    expect(result.stdout).toContain("GEMINI_API_KEY=...");
  });

  test("setup reports when snapshot API credentials are already ready", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });

    expect(result.stdout).toContain("Using OpenAI");
    expect(result.stdout).toContain("Detected OPENAI_API_KEY");
    expect(result.stdout).toContain("config.json");
    expect(result.stdout).toContain(
      "To change: npx libretto ai configure openai | anthropic | gemini | vertex",
    );
  });

  test("setup auto-pins default model when OPENAI_API_KEY is present", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });

    expect(result.stdout).toContain("Using OpenAI");
    expect(result.stdout).toContain("config.json");
  });

  test("setup rerun shows healthy summary without re-prompting", async ({
    librettoCli,
  }) => {
    // First run: pins the model
    const first = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });
    expect(first.stdout).toContain("Using OpenAI");

    // Second run: should show healthy summary, not re-prompt
    const second = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });
    expect(second.stdout).toContain("Using OpenAI");
    expect(second.stdout).toContain("config.json");
    expect(second.stdout).toContain(
      "To change: npx libretto ai configure openai | anthropic | gemini | vertex",
    );
    // Should NOT contain the unconfigured prompts
    expect(second.stdout).not.toContain(
      "No snapshot API credentials detected.",
    );
  });

  test("setup shows provider-specific message when pinned OpenAI + missing key + Anthropic present", async ({
    librettoCli,
    workspacePath,
  }) => {
    // Pin OpenAI in config, but only provide Anthropic key
    await mkdir(workspacePath(".libretto"), { recursive: true });
    await writeFile(
      workspacePath(".libretto", "config.json"),
      JSON.stringify({
        version: 1,
        snapshotModel: "openai/gpt-5.4",
      }),
      "utf8",
    );

    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    });

    // Should name the configured provider and missing env var
    expect(result.stdout).toContain("openai is configured");
    expect(result.stdout).toContain("OPENAI_API_KEY is not set");
    // Should NOT show the generic unconfigured message
    expect(result.stdout).not.toContain("No snapshot API credentials detected");
  });

  test("setup shows invalid config warning in non-TTY mode", async ({
    librettoCli,
    workspacePath,
  }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    await writeFile(
      workspacePath(".libretto", "config.json"),
      "{not-valid-json}",
      "utf8",
    );

    const result = await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-key",
    });

    expect(result.stdout).toContain("AI config is invalid");
    expect(result.stdout).toContain("reconfigure");
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
    expect(result.stdout).toContain("Usage: libretto <command>");
    expect(result.stdout).toContain("readonly-exec");
    expect(result.stdout).toContain("snapshot");
    expect(result.stdout).toContain("Capture PNG + HTML");
    expect(result.stdout).not.toContain("cloud <subcommand>");
    expect(result.stdout).toContain("experimental <subcommand>");
    expect(result.stdout).toContain("Docs (agent-friendly): https://libretto.sh/docs");
    expect(result.stderr).toBe("");
  });

  test("prints usage for help command", async ({ librettoCli }) => {
    const result = await librettoCli("help");
    expect(result.stdout).toContain("Usage: libretto <command>");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("open");
    expect(result.stdout).toContain("ai");
    expect(result.stdout).toContain("status");
    expect(result.stderr).toBe("");
  });

  test("prints scoped help for status command", async ({ librettoCli }) => {
    const result = await librettoCli("help status");
    expect(result.stdout).toContain("Show workspace status");
    expect(result.stdout).toContain("AI configuration");
    expect(result.stderr).toBe("");
  });

  test("prints scoped help for migrated SimpleCLI commands", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help ai configure");
    expect(result.stdout).toContain("Configure AI runtime");
    expect(result.stdout).toContain(
      "Usage: libretto ai configure [preset] [options]",
    );
    expect(result.stderr).toBe("");
  });

  test("prints experimental group help with deploy listed under the new namespace", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help experimental");
    expect(result.stdout).toContain("Experimental commands");
    expect(result.stdout).toContain(
      "Usage: libretto experimental <subcommand>",
    );
    expect(result.stdout).toContain("deploy");
    expect(result.stderr).toBe("");
  });

  test("prints run help with explicit visualization disable flag", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help run");
    expect(result.stdout).toContain(
      "Run the default-exported Libretto workflow from a file",
    );
    expect(result.stdout).toContain(
      "Usage: libretto run [integrationFile] [options]",
    );
    expect(result.stdout).toContain("--read-only");
    expect(result.stdout).toContain("--no-visualize");
    expect(result.stdout).toContain(
      "Disable ghost cursor + highlight visualization in headed mode",
    );
    expect(result.stderr).toBe("");
  });

  test("prints session-mode help", async ({ librettoCli }) => {
    const result = await librettoCli("help session-mode");
    expect(result.stdout).toContain("View or set the session access mode");
    expect(result.stdout).toContain(
      "Usage: libretto session-mode [mode] [options]",
    );
    expect(result.stderr).toBe("");
  });

  test("fails unknown command with a clear error", async ({ librettoCli }) => {
    const result = await librettoCli("nope-command");
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain("Usage: libretto <command>");
  });

  test("fails open with missing url usage error", async ({ librettoCli }) => {
    const result = await librettoCli("open");
    expect(result.stderr).toContain(
      "Usage: libretto open <url> [--headless] [--read-only|--write-access] [--viewport WxH] [--session <name>]",
    );
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
      `exec "return await page.title()" --session ${session}`,
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
      PATH: "/definitely-not-real",
    });
    expect(result.stderr).toContain("Failed to launch browser child process:");
    expect(result.stderr).toContain(
      "Ensure Node.js is available in PATH for child processes.",
    );
    expect(result.stderr).toContain("Check logs:");
  });

  test("warns on open when the installed skill version is out of date", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", "0.0.0");

    const result = await librettoCli("open https://example.com", {
      PATH: "/definitely-not-real",
    });

    expect(result.stderr).toContain(
      expectedSkillVersionWarning("0.0.0", cliVersion),
    );
    expect(result.stderr).toContain("Failed to launch browser child process:");
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
      "Usage: libretto exec <code|-> [--session <name>] [--visualize]",
    );
  });

  test("fails exec with missing code usage error when only flags are passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("exec --visualize --session test");
    expect(result.stderr).toContain(
      "Usage: libretto exec <code|-> [--session <name>] [--visualize]",
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
      "Usage: libretto readonly-exec <code|-> [--session <name>] [--page <id>]",
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
      "return 1;",
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

    expect(result.stderr).toContain(
      expectedSkillVersionWarning("0.0.0", cliVersion),
    );
    expect(result.stderr).toContain("Integration file does not exist:");
  });

  test("warns on connect when the installed skill version is out of date", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", "0.0.0");

    const result = await librettoCli("connect not-a-url --session mismatch");

    expect(result.stderr).toContain(
      expectedSkillVersionWarning("0.0.0", cliVersion),
    );
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("does not warn when the installed skill version matches the CLI", async ({
    librettoCli,
    workspacePath,
  }) => {
    const cliVersion = await readCliVersion();
    await seedInstalledSkillVersion(workspacePath, ".agents", cliVersion);

    const result = await librettoCli("connect not-a-url --session matching");

    expect(result.stderr).not.toContain("Warning: Your agent skill (");
    expect(result.stderr).toContain("Invalid CDP URL: not-a-url");
  });

  test("fails run with invalid JSON in --params", async ({ librettoCli }) => {
    const result = await librettoCli('run ./integration.ts --params "{not-json}"');
    expect(result.stderr).toContain("Invalid JSON in --params:");
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
export default workflow("main", async () => {
  return "ok";
});
`,
    );

    const result = await librettoCli(
      "run ./integration.ts --auth-profile app.example.com",
    );
    expect(result.stderr).toContain(
      'Local auth profile not found for domain "app.example.com".',
    );
    expect(result.stderr).toContain(
      "libretto open https://app.example.com --headed --session",
    );
    expect(result.stderr).toContain("libretto save app.example.com --session");
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
    expect(resumed.stdout).toContain(`Resume signal sent for session "${session}".`);
    expect(resumed.stdout).toContain("WORKFLOW_AFTER_RESUME");
    expect(resumed.stdout).toContain("Integration completed.");
    expect(resumed.stderr).toBe("");
  }, 45_000);

  test("pause reports running sessions when session id is missing", async ({
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
    expect(result.stderr).toContain("Running sessions:");
    expect(result.stderr).toContain("pause-test");
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
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" --session complete-test --headless`,
    );
    expect(result.stdout).toContain("WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).not.toContain("Workflow paused.");
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
    expect(result.stderr).toContain(
      "Usage: libretto save <url|domain> --session <name>",
    );
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
