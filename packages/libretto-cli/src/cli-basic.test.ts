import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("basic CLI subprocess behavior", () => {
  test("prints usage for --help", async ({ librettoCli }) => {
    const result = await librettoCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: libretto-cli <command> [--session <name>]");
    expect(result.stderr).toBe("");
  });

  test("bootstraps .libretto state on --help without creating legacy dirs", async ({
    librettoCli,
    workspacePath,
  }) => {
    const result = await librettoCli("--help");
    expect(result.exitCode).toBe(0);

    expect(existsSync(workspacePath(".libretto"))).toBe(true);
    expect(existsSync(workspacePath(".libretto", ".gitignore"))).toBe(true);
    expect(existsSync(workspacePath(".libretto", "sessions"))).toBe(true);
    expect(existsSync(workspacePath(".libretto", "profiles"))).toBe(true);

    expect(existsSync(workspacePath(".libretto-cli"))).toBe(false);
    expect(existsSync(workspacePath("tmp", "libretto-cli"))).toBe(false);
  });

  test("prints usage for help command", async ({ librettoCli }) => {
    const result = await librettoCli("help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Commands:");
    expect(result.stderr).toBe("");
  });

  test("fails unknown command with non-zero exit code", async ({ librettoCli }) => {
    const result = await librettoCli("nope-command");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: nope-command");
    expect(result.stdout).toContain("Usage: libretto-cli <command> [--session <name>]");
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
      "Session \"default\" is read-only. Only a human can authorize interactive mode.",
    );
  });

  test("allows run guard when session is permissioned interactive", async ({
    librettoCli,
    seedSessionPermission,
  }) => {
    await seedSessionPermission("default", "interactive");
    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("is read-only");
    expect(result.stderr).toContain("Integration file does not exist:");
  });

  test("fails run when export is not a Libretto workflow instance", async ({
    librettoCli,
    seedSessionPermission,
    workspacePath,
  }) => {
    await seedSessionPermission("default", "interactive");
    await writeFile(
      workspacePath("integration.ts"),
      `
export async function main() {
  return "ok";
}
`,
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must be a Libretto workflow instance");
  });

  test("accepts branded Libretto workflow contract across module boundaries", async ({
    librettoCli,
    seedSessionPermission,
    workspacePath,
  }) => {
    await seedSessionPermission("default", "interactive");
    await writeFile(
      workspacePath("integration.ts"),
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
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: workspacePath("missing-playwright-browsers"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("must be a Libretto workflow instance");
  });

  test("fails run when local auth profile is declared but missing", async ({
    librettoCli,
    seedSessionPermission,
    workspacePath,
  }) => {
    const librettoEntryUrl = new URL(
      "../../libretto/src/workflow/workflow.ts",
      import.meta.url,
    ).href;
    await seedSessionPermission("default", "interactive");
    await writeFile(
      workspacePath("integration.ts"),
      `
import { workflow } from "${librettoEntryUrl}";

export const main = workflow(
  { authProfile: { type: "local", domain: "app.example.com" } },
  async () => {
    return "ok";
  },
);
`,
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Local auth profile not found for domain "app.example.com".',
    );
    expect(result.stderr).toContain(
      "Expected profile file:",
    );
    expect(result.stderr).toContain(
      ".libretto-cli/profiles/app.example.com.json",
    );
    expect(result.stderr).toContain(
      "libretto-cli open https://app.example.com --headed --session default",
    );
    expect(result.stderr).toContain("libretto-cli save app.example.com --session default");
  });

  test("does not require local auth profile when auth metadata is absent", async ({
    librettoCli,
    seedSessionPermission,
    workspacePath,
  }) => {
    const librettoEntryUrl = new URL(
      "../../libretto/src/workflow/workflow.ts",
      import.meta.url,
    ).href;
    await seedSessionPermission("default", "interactive");
    await writeFile(
      workspacePath("integration.ts"),
      `
import { workflow } from "${librettoEntryUrl}";

export const main = workflow({}, async () => "ok");
`,
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: workspacePath("missing-playwright-browsers"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("Local auth profile not found for domain");
  });

  test("proceeds when declared local auth profile file exists", async ({
    librettoCli,
    seedSessionPermission,
    workspacePath,
  }) => {
    const librettoEntryUrl = new URL(
      "../../libretto/src/workflow/workflow.ts",
      import.meta.url,
    ).href;
    await seedSessionPermission("default", "interactive");
    await writeFile(
      workspacePath("integration.ts"),
      `
import { workflow } from "${librettoEntryUrl}";

export const main = workflow(
  { authProfile: { type: "local", domain: "app.example.com" } },
  async () => "ok",
);
`,
      "utf8",
    );
    await mkdir(workspacePath(".libretto-cli", "profiles"), { recursive: true });
    await writeFile(
      workspacePath(".libretto-cli", "profiles", "app.example.com.json"),
      JSON.stringify({ cookies: [], origins: [] }),
      "utf8",
    );

    const result = await librettoCli("run ./integration.ts main", {
      PLAYWRIGHT_BROWSERS_PATH: workspacePath("missing-playwright-browsers"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("Local auth profile not found for domain");
  });

  test("fails open when deprecated --allow-actions flag is passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("open https://example.com --allow-actions");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--allow-actions is not supported for open.",
    );
  });

  test("fails run when deprecated --allow-actions flag is passed", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("run ./integration.ts main --allow-actions");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--allow-actions is not supported for run.");
  });

  test("session-mode interactive writes session permission", async ({
    librettoCli,
    workspacePath,
  }) => {
    const result = await librettoCli(
      "session-mode interactive --session consented",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Session \"consented\" is now interactive.");

    const raw = JSON.parse(
      await readFile(
        workspacePath(".libretto-cli", "session-permissions.json"),
        "utf8",
      ),
    ) as { sessions?: Record<string, string> };
    expect(raw.sessions?.consented).toBe("interactive");
  });

  test("session-mode read-only removes interactive permission", async ({
    librettoCli,
    workspacePath,
  }) => {
    await librettoCli("session-mode interactive --session toggled");
    const result = await librettoCli("session-mode read-only --session toggled");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Session \"toggled\" is now read-only.");

    const raw = JSON.parse(
      await readFile(
        workspacePath(".libretto-cli", "session-permissions.json"),
        "utf8",
      ),
    ) as { sessions?: Record<string, string> };
    expect(raw.sessions?.toggled).toBeUndefined();
  });

  test("fails session-mode with invalid mode", async ({ librettoCli }) => {
    const result = await librettoCli("session-mode maybe --session default");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: libretto-cli session-mode <read-only|interactive> [--session <name>]",
    );
  });

  test("fails save with missing target usage error", async ({ librettoCli }) => {
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
