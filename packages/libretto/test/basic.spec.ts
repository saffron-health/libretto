import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("basic CLI subprocess behavior", () => {
  test("prints usage for --help", async ({ librettoCli }) => {
    const result = await librettoCli("--help");
    expect(result.stdout).toContain("Usage: libretto-cli <command>");
    expect(result.stdout).toContain(
      "snapshot  Capture PNG + HTML; analyze when --objective is provided (--context optional)",
    );
    expect(result.stderr).toBe("");
  });

  test("prints usage for help command", async ({ librettoCli }) => {
    const result = await librettoCli("help");
    expect(result.stdout).toContain("Usage: libretto-cli <command>");
    expect(result.stdout).toContain("Commands:");
    expect(result.stderr).toBe("");
  });

  test("prints scoped help for migrated SimpleCLI commands", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help ai configure");
    expect(result.stdout).toContain("Configure AI runtime");
    expect(result.stdout).toContain("Usage: libretto-cli ai configure [preset] [options]");
    expect(result.stderr).toBe("");
  });

  test("fails unknown command with a clear error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("nope-command");
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain("Usage: libretto-cli <command>");
  });

  test("fails open with missing url usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open");
    expect(result.stderr).toContain(
      "Usage: libretto-cli open <url> [--headless] [--session <name>]",
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

  test("fails exec with missing code usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("exec");
    expect(result.stderr).toContain(
      "Usage: libretto-cli exec <code> [--session <name>] [--visualize]",
    );
  });

  test("fails run when integration file does not exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("run ./integration.ts main");
    expect(result.stderr).toContain("Integration file does not exist:");
    expect(result.stderr).toContain("/integration.ts");
  });

  test("fails run with invalid JSON in --params", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(
      "run ./integration.ts main --params \"{not-json}\"",
    );
    expect(result.stderr).toContain("Invalid JSON in --params:");
  });

  test("fails run with invalid JSON in --params-file", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "invalid-params.json");
    await writeFile(paramsPath, "{not-json}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts main --params-file "${paramsPath}"`,
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
    expect(result.stderr).toContain("libretto-cli open https://app.example.com --headed --session default");
    expect(result.stderr).toContain("libretto-cli save app.example.com --session default");
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
  await pause();
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
      "Usage: libretto-cli save <url|domain> [--session <name>]",
    );
  });

  test("fails when --session value is missing", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help --session");
    expect(result.stderr).toContain("Missing or invalid --session value.");
  });

  test("fails when --session value is another command token", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help --session open");
    expect(result.stderr).toContain("Missing or invalid --session value.");
  });
});
