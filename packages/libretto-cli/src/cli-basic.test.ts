import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("basic CLI subprocess behavior", () => {
  test("prints usage for --help", async ({ librettoCli }) => {
    const result = await librettoCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: libretto-cli <command> [--session <name>]");
    expect(result.stderr).toBe("");
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

  test("fails exec with missing code usage error", async ({ librettoCli }) => {
    const result = await librettoCli("exec");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: libretto-cli exec <code> [--session <name>] [--visualize]",
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
