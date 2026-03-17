import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("basic CLI subprocess behavior", () => {
  test("init explains snapshot API env setup when no credentials are configured", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("init --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
    });

    expect(result.stdout).toContain("Snapshot analysis:");
    expect(result.stdout).toContain("No snapshot API credentials detected.");
    expect(result.stdout).toContain("OPENAI_API_KEY=...");
    expect(result.stdout).toContain("ANTHROPIC_API_KEY=...");
    expect(result.stdout).toContain("GEMINI_API_KEY=...");
  });

  test("init reports when snapshot API credentials are already ready", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("init --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });

    expect(result.stdout).toContain("Snapshot analysis:");
    expect(result.stdout).toContain("Ready: openai/gpt-5.4");
    expect(result.stdout).toContain("No further action required.");
  });

  test("prints usage for --help", async ({ librettoCli, evaluate }) => {
    const result = await librettoCli("--help");
    await evaluate(result.stdout).toMatch(
      "Shows the root CLI help with top-level command usage and includes the snapshot command description.",
    );
    expect(result.stderr).toBe("");
  });

  test("prints usage for help command", async ({ librettoCli, evaluate }) => {
    const result = await librettoCli("help");
    await evaluate(result.stdout).toMatch(
      "Shows the root CLI help with the top-level commands list.",
    );
    expect(result.stderr).toBe("");
  });

  test("prints scoped help for migrated SimpleCLI commands", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help ai configure");
    expect(result.stdout).toContain("Configure AI runtime");
    expect(result.stdout).toContain("Usage: libretto ai configure [preset] [options]");
    expect(result.stderr).toBe("");
  });

  test("accepts global --session on non-session commands", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("ai configure openai --session review-bot");
    expect(result.stderr).toBe("");
    await evaluate(result.stdout).toMatch(
      "Confirms the AI config was saved.",
    );
  });

  test("accepts global --session before the command path", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("--session review-bot ai configure openai");
    expect(result.stderr).toBe("");
    await evaluate(result.stdout).toMatch(
      "Confirms the AI config was saved.",
    );
  });

  test("fails unknown command with a clear error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("nope-command");
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain("Usage: libretto <command>");
  });

  test("fails open with missing url usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open");
    expect(result.stderr).toContain(
      "Usage: libretto open <url> [--headless] [--viewport WxH] [--session <name>]",
    );
  });

  test("fails open with actionable error when browser child spawn fails", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open https://example.com", {
      PATH: "/definitely-not-real",
    });
    expect(result.stderr).toContain("Failed to launch browser child process:");
    expect(result.stderr).toContain("Ensure Node.js is available in PATH for child processes.");
    expect(result.stderr).toContain("Check logs:");
  });

  test("defaults sessioned browser commands to the default session", async ({
    librettoCli,
    evaluate,
  }) => {
    const opened = await librettoCli("open https://example.com --headless");
    await evaluate(opened.stdout).toMatch(
      "Confirms the browser opened successfully for example.com in the default session.",
    );
    expect(opened.stderr).toBe("");

    const pages = await librettoCli("pages");
    await evaluate(pages.stdout).toMatch(
      "Lists the currently open page for example.com.",
    );
    expect(pages.stderr).toBe("");

    const close = await librettoCli("close");
    await evaluate(close.stdout).toMatch(
      'Reports that the browser for session "default" was closed.',
    );
    expect(close.stderr).toBe("");
  }, 45_000);

  test("fails exec with missing code usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("exec");
    expect(result.stderr).toContain(
      "Usage: libretto exec <code> [--session <name>] [--visualize]",
    );
  });

  test("fails exec with missing code usage error when only flags are passed", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("exec --visualize");
    await evaluate(result.stderr).toMatch(
      "Shows usage for exec command requiring code with optional session and visualize flags.",
    );
    expect(result.stderr).not.toContain(`Missing required --session for "exec".`);
  });

  test("fails run when integration file does not exist", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("run ./integration.ts main");
    await evaluate(result.stderr).toMatch(
      "Explains that the integration file does not exist and mentions the integration.ts path.",
    );
  });

  test("fails run with invalid JSON in --params", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli(
      "run ./integration.ts main --params \"{not-json}\"",
    );
    await evaluate(result.stderr).toMatch(
      "Reports that --params contained invalid JSON.",
    );
  });

  test("fails fast for invalid session names before command execution", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli(
      "open https://example.com --session ../bad-name",
    );
    expect(result.stdout).toBe("");
    await evaluate(result.stderr).toMatch(
      "Reports that the provided session name is invalid and only allows letters, numbers, dots, underscores, and dashes.",
    );
  });

  test("fails fast for invalid inline session names before command execution", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli(
      "--session=../bad-name open https://example.com",
    );
    expect(result.stdout).toBe("");
    await evaluate(result.stderr).toMatch(
      "Reports that the provided session name is invalid and only allows letters, numbers, dots, underscores, and dashes.",
    );
  });

  test("accepts hyphen-prefixed session values", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("pages --session -dash");
    await evaluate(result.stderr).toMatch(
      'Explains that session "-dash" does not exist, no active sessions are available, and suggests opening a session with libretto open <url> --session -dash.',
    );
    expect(result.stderr).not.toContain("Missing value for --session.");
  });

  test("fails run with invalid JSON in --params-file", async ({
    librettoCli,
    evaluate,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "invalid-params.json");
    await writeFile(paramsPath, "{not-json}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts main --params-file "${paramsPath}"`,
    );
    await evaluate(result.stderr).toMatch(
      "Reports that --params-file contained invalid JSON.",
    );
  });

  test("fails run when --params and --params-file are both provided", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "params.json");
    await writeFile(paramsPath, "{}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts main --params "{}" --params-file "${paramsPath}"`,
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
      `run ./integration.ts main --params-file "${missingPath}"`,
    );
    expect(result.stderr).toContain(
      `Could not read --params-file "${missingPath}". Ensure the file exists and is readable.`,
    );
  });

  test("fails run when export is not a Libretto workflow instance", async ({
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

    const result = await librettoCli("run ./integration.ts main");
    expect(result.stderr).toContain(
      'Export "main" in',
    );
    expect(result.stderr).toContain("is not a valid Libretto workflow.");
  });

  test("run forwards --tsconfig to tsx for workflow imports", async ({
    librettoCli,
    evaluate,
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

export const main = workflow({}, async () => {
  console.log(message);
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" main --tsconfig "${workspacePath("feature", "tsconfig.json")}" --session default --headless`,
    );
    await evaluate(result.stdout).toMatch(
      "Includes TSCONFIG_ALIAS_OK and Integration completed.",
    );
  }, 45_000);

  test("run compile failures mention --tsconfig guidance", async ({
    librettoCli,
    evaluate,
    workspacePath,
  }) => {
    await writeFile(
      workspacePath("integration-compile-error.ts"),
      "const = 1;\n",
      "utf8",
    );
    const result = await librettoCli(
      'run "./integration-compile-error.ts" main --session default --headless',
    );
    await evaluate(result.stderr).toMatch(
      "Reports that importing the integration module failed because of a TypeScript compilation error and includes guidance to pass --tsconfig <path>.",
    );
    expect(result.stderr).not.toContain("Browser is still open.");
    expect(result.stderr).not.toContain("use `exec` to inspect it");
  }, 45_000);

  test("accepts branded Libretto workflow contract across module boundaries", async ({
    librettoCli,
    workspaceDir,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
const brand = Symbol.for("libretto.workflow");

export const main = {
  [brand]: true,
  metadata: {},
  async run() {
    return "ok";
  },
};
`,
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: join(
        workspaceDir,
        "missing-playwright-browsers",
      ),
    });
    expect(result.stderr).not.toContain("is not a Libretto workflow");
  });

  test("fails run when local auth profile is declared but missing", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const main = workflow(
  {},
  async () => {
    return "ok";
  },
);
`,
    );

    const result = await librettoCli("run ./integration.ts main --auth-profile app.example.com");
    expect(result.stderr).toContain(
      'Local auth profile not found for domain "app.example.com".',
    );
    expect(result.stderr).toContain("libretto open https://app.example.com --headed --session default");
    expect(result.stderr).toContain("libretto save app.example.com --session default");
  });

  test("does not require local auth profile when auth metadata is absent", async ({
    librettoCli,
    workspaceDir,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const main = workflow({}, async () => "ok");
`,
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: join(
        workspaceDir,
        "missing-playwright-browsers",
      ),
    });
    expect(result.stderr).not.toContain("No local auth profile found");
  });

  test("returns paused status when workflow hits standalone pause", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-pause.mjs",
      `
export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await pause("default");
  console.log("WORKFLOW_AFTER_PAUSE");
});
`,
      ["workflow", "pause"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" main --session default --headless`,
    );
    expect(result.stdout).toContain("WORKFLOW_BEFORE_PAUSE");
    expect(result.stdout).toContain("Workflow paused.");
    expect(result.stdout).not.toContain("WORKFLOW_AFTER_PAUSE");
    expect(result.stdout).not.toContain("Integration completed.");
  }, 45_000);

  test("pause reports running sessions when session id is missing", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-pause-missing-session.mjs",
      `
export const main = workflow({}, async () => {
  await pause("");
});
`,
      ["workflow", "pause"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" main --session default --headless`,
    );
    expect(result.stderr).toContain(
      "pause(session) requires a non-empty session ID.",
    );
    expect(result.stderr).toContain("Running sessions:");
    expect(result.stderr).toContain("default");
  }, 45_000);

  test("completes workflow run when no pause is triggered", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-complete.mjs",
      `
export const main = workflow({}, async () => {
  console.log("WORKFLOW_COMPLETES");
});
`,
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" main --session default --headless`,
    );
    expect(result.stdout).toContain("WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).not.toContain("Workflow paused.");
  }, 45_000);

  test("run prints failure guidance and keeps browser open for exec inspection", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const session = "debug-selector-error-guidance";
    const integrationFilePath = await writeWorkflow(
      "integration-selector-error-debug.mjs",
      `
export const main = workflow({}, async (ctx) => {
  await ctx.page.goto("https://example.com");
  await ctx.page.locator("[").click();
});
`,
    );

    const runResult = await librettoCli(
      `run "${integrationFilePath}" main --session ${session} --headless`,
    );
    expect(runResult.stderr).toContain("locator.click:");
    expect(runResult.stderr).toContain("Browser is still open.");
    expect(runResult.stderr).toContain("use `exec` to inspect it");
    expect(runResult.stderr).toContain("Call `run` to re-run the workflow.");

    const rerunResult = await librettoCli(
      `run "${integrationFilePath}" main --session ${session} --headless`,
    );
    expect(rerunResult.stderr).toContain("locator.click:");
    expect(rerunResult.stderr).toContain("Browser is still open.");
    expect(rerunResult.stderr).toContain("use `exec` to inspect it");
    expect(rerunResult.stderr).toContain("Call `run` to re-run the workflow.");
    expect(rerunResult.stderr).not.toContain("is already open and connected to");
  }, 60_000);

  test("fails save with missing target usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("save");
    expect(result.stderr).toContain(
      "Usage: libretto save <url|domain> [--session <name>]",
    );
  });

  test("fails when --session value is missing", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli(`exec "return 1" --session`);
    await evaluate(result.stderr).toMatch(
      "Reports that --session is missing its required value.",
    );
  });

  test("allows session names that match command tokens", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("pages --session open");
    expect(result.stdout).toBe("");
    await evaluate(result.stderr).toMatch(
      'Explains that session "open" does not exist, no active sessions are available, and suggests opening a session with libretto open <url> --session open.',
    );
  });

});
