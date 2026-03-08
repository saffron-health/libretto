import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  test("fails run by default in read-only session", async ({ librettoCli }) => {
    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Session "default" is read-only. Only a human can authorize full-access mode.',
    );
  });

  test("allows run guard when session is permissioned full-access", async ({
    librettoCli,
  }) => {
    await librettoCli("session-mode full-access --session default");
    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("is read-only");
    expect(result.stderr).toContain("Integration file does not exist:");
  });

  test("fails run when export is not a Libretto workflow instance", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await librettoCli("session-mode full-access --session default");
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
    await librettoCli("session-mode full-access --session default");
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
    await librettoCli("session-mode full-access --session default");
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
    await librettoCli("session-mode full-access --session default");
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
    await librettoCli("session-mode full-access --session default");
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

  test("returns paused status when workflow hits debugPause", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    await librettoCli("session-mode full-access --session default");
    const integrationFilePath = await writeWorkflow(
      "integration-pause.mjs",
      `
export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await debugPause(ctx.page, { enabled: ctx.debug, sessionName: ctx.session });
  console.log("WORKFLOW_AFTER_PAUSE");
});
`,
      ["workflow", "debugPause"],
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
    await librettoCli("session-mode full-access --session default");
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

  test("fails open when deprecated --allow-actions flag is passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(
      "open https://example.com --allow-actions",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--allow-actions is not supported for open.",
    );
  });

  test("fails run when deprecated --allow-actions flag is passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(
      "run ./integration.ts main --allow-actions",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--allow-actions is not supported for run.",
    );
  });

  test("session-mode full-access writes session permission", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const result = await librettoCli(
      "session-mode full-access --session consented",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Session "consented" is now full-access.');

    const raw = JSON.parse(
      await readFile(join(workspaceDir, ".libretto", "config.json"), "utf8"),
    ) as {
      permissions?: {
        sessions?: Record<string, string>;
      };
    };
    expect(raw.permissions?.sessions?.consented).toBe("full-access");
  });

  test("session-mode read-only removes full-access permission", async ({
    librettoCli,
    workspaceDir,
  }) => {
    await librettoCli("session-mode full-access --session toggled");
    const result = await librettoCli(
      "session-mode read-only --session toggled",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Session "toggled" is now read-only.');

    const raw = JSON.parse(
      await readFile(join(workspaceDir, ".libretto", "config.json"), "utf8"),
    ) as {
      permissions?: {
        sessions?: Record<string, string>;
      };
    };
    expect(raw.permissions?.sessions?.toggled).toBeUndefined();
  });

  test("fails session-mode with invalid mode", async ({ librettoCli }) => {
    const result = await librettoCli("session-mode maybe --session default");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: libretto-cli session-mode <read-only|full-access> [--session <name>]",
    );
  });

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
