import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

describe("basic CLI subprocess behavior", () => {
  test("prints usage for --help", async ({ librettoCli }) => {
    const result = await librettoCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: libretto-cli <command> [--session <name>]",
    );
    expect(result.stdout).toContain(
      "Capture PNG + HTML; analyze when objective is provided (context optional)",
    );
    expect(result.stderr).toBe("");
  });

  test("bootstraps .libretto state on --help without creating legacy dirs", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const result = await librettoCli("--help");
    expect(result.exitCode).toBe(0);

    expect(existsSync(join(workspaceDir, ".libretto"))).toBe(true);
    expect(existsSync(join(workspaceDir, ".libretto", ".gitignore"))).toBe(
      true,
    );
    expect(existsSync(join(workspaceDir, ".libretto", "sessions"))).toBe(true);
    expect(existsSync(join(workspaceDir, ".libretto", "profiles"))).toBe(true);

    expect(existsSync(join(workspaceDir, ".libretto-cli"))).toBe(false);
    expect(existsSync(join(workspaceDir, "tmp", "libretto-cli"))).toBe(false);
  });

  test("prints usage for help command", async ({ librettoCli }) => {
    const result = await librettoCli("help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Commands:");
    expect(result.stderr).toBe("");
  });

  test("fails unknown command with non-zero exit code", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("nope-command");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain(
      "Usage: libretto-cli <command> [--session <name>]",
    );
  });

  test("fails open with missing url usage error", async ({ librettoCli }) => {
    const result = await librettoCli("open");
    expect(result.exitCode).toBe(1);
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
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to launch browser child process:");
    expect(result.stderr).toContain(
      "Ensure Node.js is available in PATH for child processes.",
    );
    expect(result.stderr).toContain("Check logs:");
  });

  test("fails exec with missing code usage error", async ({ librettoCli }) => {
    const result = await librettoCli("exec");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: libretto-cli exec <code> [--session <name>] [--visualize]",
    );
  });

  test("fails run when integration file does not exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Integration file does not exist:");
  });

  test("fails run with invalid JSON in --params", async ({ librettoCli }) => {
    const result = await librettoCli(
      "run ./integration.ts main --params \"{not-json}\"",
    );
    expect(result.exitCode).toBe(1);
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
    expect(result.exitCode).toBe(1);
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
    expect(result.exitCode).toBe(1);
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
    expect(result.exitCode).toBe(1);
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
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must be a Libretto workflow instance");
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
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("must be a Libretto workflow instance");
  });

  test("fails run when local auth profile is declared but missing", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const main = workflow(
  { authProfile: { type: "local", domain: "app.example.com" } },
  async () => {
    return "ok";
  },
);
`,
    );

    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Local auth profile not found for domain "app.example.com".',
    );
    expect(result.stderr).toContain("Expected profile file:");
    expect(result.stderr).toContain(".libretto/profiles/app.example.com.json");
    expect(result.stderr).toContain(
      "libretto-cli open https://app.example.com --headed --session default",
    );
    expect(result.stderr).toContain(
      "libretto-cli save app.example.com --session default",
    );
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
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(
      "Local auth profile not found for domain",
    );
  });

  test("proceeds when declared local auth profile file exists", async ({
    librettoCli,
    workspaceDir,
    writeWorkflow,
  }) => {
    await writeWorkflow(
      "integration.ts",
      `
export const main = workflow(
  { authProfile: { type: "local", domain: "app.example.com" } },
  async () => "ok",
);
`,
    );
    await mkdir(join(workspaceDir, ".libretto", "profiles"), {
      recursive: true,
    });
    await writeFile(
      join(workspaceDir, ".libretto", "profiles", "app.example.com.json"),
      JSON.stringify({ cookies: [], origins: [] }),
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: join(
        workspaceDir,
        "missing-playwright-browsers",
      ),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(
      "Local auth profile not found for domain",
    );
  });

  test("returns paused status when workflow hits ctx.pause", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-pause.mjs",
      `
export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await ctx.pause();
  console.log("WORKFLOW_AFTER_PAUSE");
});
`,
      ["workflow"],
    );

    const result = await librettoCli(
      `run "${integrationFilePath}" main --session default --headless --debug`,
    );
    expect(result.exitCode).toBe(0);
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
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORKFLOW_COMPLETES");
    expect(result.stdout).toContain("Integration completed.");
    expect(result.stdout).not.toContain("Workflow paused.");
  }, 45_000);

  test("fails save with missing target usage error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("save");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: libretto-cli save <url|domain> [--session <name>]",
    );
  });

  test("fails when --session value is missing", async ({ librettoCli }) => {
    const result = await librettoCli("help --session");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing or invalid --session value.");
  });

  test("fails when --session value is another command token", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("help --session open");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing or invalid --session value.");
  });
});
