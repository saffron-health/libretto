import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe } from "vitest";
import { test } from "./fixtures";

describe("basic CLI subprocess behavior", () => {
  test("prints usage for --help", async ({ librettoCli, evaluate }) => {
    const result = await librettoCli("--help");
    await evaluate(result.stdout).toMatch(
      "Shows top-level usage for libretto-cli and includes guidance that snapshot can analyze when objective is provided.",
    );
    await evaluate(result.stderr).toMatch("Is empty.");
  });

  test("prints usage for help command", async ({ librettoCli, evaluate }) => {
    const result = await librettoCli("help");
    await evaluate(result.stdout).toMatch(
      "Contains a commands listing section for CLI help.",
    );
    await evaluate(result.stderr).toMatch("Is empty.");
  });

  test("fails unknown command with non-zero exit code", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("nope-command");
    await evaluate(result.stderr).toMatch(
      "Explains that nope-command is an unknown command.",
    );
    await evaluate(result.stdout).toMatch(
      "Shows top-level libretto-cli usage guidance.",
    );
  });

  test("fails open with missing url usage error", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("open");
    await evaluate(result.stderr).toMatch(
      "Shows usage for open command that requires a URL and includes optional headless/session flags.",
    );
  });

  test("fails open with actionable error when browser child spawn fails", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("open https://example.com", {
      PATH: "/definitely-not-real",
    });
    await evaluate(result.stderr).toMatch(
      "States browser child process launch failed, advises ensuring Node.js is in PATH, and includes a logs hint.",
    );
  });

  test("fails exec with missing code usage error", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("exec");
    await evaluate(result.stderr).toMatch(
      "Shows usage for exec command requiring code with optional session and visualize flags.",
    );
  });

  test("fails run when integration file does not exist", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("run ./integration.ts main");
    await evaluate(result.stderr).toMatch(
      "Explains that the integration file does not exist.",
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
      "Reports invalid JSON in --params.",
    );
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
      "Reports invalid JSON in --params-file.",
    );
  });

  test("fails run when --params and --params-file are both provided", async ({
    librettoCli,
    evaluate,
    workspaceDir,
  }) => {
    const paramsPath = join(workspaceDir, "params.json");
    await writeFile(paramsPath, "{}", "utf8");

    const result = await librettoCli(
      `run ./integration.ts main --params "{}" --params-file "${paramsPath}"`,
    );
    await evaluate(result.stderr).toMatch(
      "Tells the user to pass either --params or --params-file, not both.",
    );
  });

  test("fails run with stable error when --params-file is missing", async ({
    librettoCli,
    evaluate,
    workspaceDir,
  }) => {
    const missingPath = join(workspaceDir, "missing-params.json");

    const result = await librettoCli(
      `run ./integration.ts main --params-file "${missingPath}"`,
    );
    await evaluate(result.stderr).toMatch(
      `Says it could not read --params-file at "${missingPath}" and tells the user to ensure the file exists and is readable.`,
    );
  });

  test("fails run when export is not a Libretto workflow instance", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stderr).toMatch(
      "Says the selected export must be a Libretto workflow instance.",
    );
  });

  test("accepts branded Libretto workflow contract across module boundaries", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stderr).toMatch(
      "Does not claim that the export must be a Libretto workflow instance.",
    );
  });

  test("fails run when local auth profile is declared but missing", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stderr).toMatch(
      'Explains local auth profile is missing for domain "app.example.com" and includes suggested open/save commands for that domain.',
    );
  });

  test("does not require local auth profile when auth metadata is absent", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stderr).toMatch(
      "Does not mention a missing local auth profile for any domain.",
    );
  });

  test("returns paused status when workflow hits ctx.pause", async ({
    librettoCli,
    evaluate,
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
      `run "${integrationFilePath}" main --session default --headless`,
    );
    await evaluate(result.stdout).toMatch(
      "Includes WORKFLOW_BEFORE_PAUSE and Workflow paused, and does not include WORKFLOW_AFTER_PAUSE or Integration completed.",
    );
  }, 45_000);

  test("completes workflow run when no pause is triggered", async ({
    librettoCli,
    evaluate,
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
    await evaluate(result.stdout).toMatch(
      "Includes WORKFLOW_COMPLETES and Integration completed, and does not include Workflow paused.",
    );
  }, 45_000);

  test("run prints failure guidance and keeps browser open for exec inspection", async ({
    librettoCli,
    evaluate,
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

    try {
      const runResult = await librettoCli(
        `run "${integrationFilePath}" main --session ${session} --headless`,
      );
      await evaluate(runResult.stderr).toMatch(
        "Includes the workflow error and also gives guidance that the browser is still open, to use exec for inspection, and to run run again to re-run the workflow.",
      );

      const rerunResult = await librettoCli(
        `run "${integrationFilePath}" main --session ${session} --headless`,
      );
      await evaluate(rerunResult.stderr).toMatch(
        "Includes the workflow error and the same casual guidance that browser stays open for exec and run can rerun, and does not say the session is already open and connected.",
      );
    } finally {
      await librettoCli(`close --session ${session}`);
    }
  }, 60_000);

  test("fails save with missing target usage error", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("save");
    await evaluate(result.stderr).toMatch(
      "Shows usage for save command requiring url or domain with optional session flag.",
    );
  });

  test("fails when --session value is missing", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("help --session");
    await evaluate(result.stderr).toMatch(
      "Reports missing or invalid --session value.",
    );
  });

  test("fails when --session value is another command token", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("help --session open");
    await evaluate(result.stderr).toMatch(
      "Reports missing or invalid --session value.",
    );
  });
});
