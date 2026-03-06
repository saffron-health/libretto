import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

const librettoEntryUrl = new URL("../../libretto/dist/index.js", import.meta.url).href;

describe("libretto run debug pause workflow", () => {
  test("returns paused status when workflow hits debugPause", async ({
    librettoCli,
    seedSessionPermission,
    writeWorkflowScript,
  }) => {
    await librettoCli("--help");
    await seedSessionPermission("default", "interactive");

    const integrationFilePath = await writeWorkflowScript(
      "integration.mjs",
      `
import { workflow, debugPause } from "${librettoEntryUrl}";

export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await debugPause(ctx.page, { enabled: ctx.debug });
  console.log("WORKFLOW_AFTER_PAUSE");
  return "ok";
});
`,
    );

    const result = await librettoCli(
      `run ${integrationFilePath} main --session default --headless --debug`,
    );

    expect(result.stdout).toContain("WORKFLOW_BEFORE_PAUSE");
  }, 20_000);
});
