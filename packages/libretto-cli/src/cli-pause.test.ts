import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("CLI pause behavior", () => {
  test("resume waits until workflow completes", async ({
    librettoCli,
    librettoRuntimePath,
    seedSessionPermission,
    writeWorkflowScript,
  }) => {
    await seedSessionPermission("default", "full-access");
    const integrationFilePath = await writeWorkflowScript(
      "integration-pause-once.mjs",
      `
import { workflow } from "${
  librettoRuntimePath
}";

export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE");
  await ctx.pause();
  console.log("WORKFLOW_AFTER_PAUSE");
});
`,
    );

    try {
      const runResult = await librettoCli(
        `run "${integrationFilePath}" main --session default --headless --debug`,
      );
      expect(runResult.exitCode).toBe(0);
      expect(runResult.stdout).toContain("WORKFLOW_BEFORE_PAUSE");
      expect(runResult.stdout).toContain("Workflow paused.");
      expect(runResult.stdout).not.toContain("WORKFLOW_AFTER_PAUSE");
      expect(runResult.stdout).not.toContain("Integration completed.");

      const resumeResult = await librettoCli("resume --session default");
      expect(resumeResult.exitCode).toBe(0);
      expect(resumeResult.stdout).toContain(
        'Resume signal sent for session "default".',
      );
      expect(resumeResult.stdout).toContain("WORKFLOW_AFTER_PAUSE");
      expect(resumeResult.stdout).toContain("Integration completed.");
    } finally {
      await librettoCli("close --session default");
    }
  }, 45_000);

  test("resume returns when workflow pauses again", async ({
    librettoCli,
    librettoRuntimePath,
    seedSessionPermission,
    writeWorkflowScript,
  }) => {
    await seedSessionPermission("default", "full-access");
    const integrationFilePath = await writeWorkflowScript(
      "integration-pause-twice.mjs",
      `
import { workflow } from "${
  librettoRuntimePath
}";

export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_BEFORE_PAUSE_1");
  await ctx.pause();
  console.log("WORKFLOW_BETWEEN_PAUSES");
  await ctx.pause();
  console.log("WORKFLOW_AFTER_PAUSE_2");
});
`,
    );

    try {
      const runResult = await librettoCli(
        `run "${integrationFilePath}" main --session default --headless --debug`,
      );
      expect(runResult.exitCode).toBe(0);
      expect(runResult.stdout).toContain("Workflow paused.");
      expect(runResult.stdout).not.toContain("WORKFLOW_AFTER_PAUSE_2");

      const firstResume = await librettoCli("resume --session default");
      expect(firstResume.exitCode).toBe(0);
      expect(firstResume.stdout).toContain("Workflow paused.");
      expect(firstResume.stdout).not.toContain("Integration completed.");

      const secondResume = await librettoCli("resume --session default");
      expect(secondResume.exitCode).toBe(0);
      expect(secondResume.stdout).toContain("Integration completed.");
    } finally {
      await librettoCli("close --session default");
    }
  }, 45_000);

  test("handles multiple pause and resume cycles", async ({
    librettoCli,
    librettoRuntimePath,
    seedSessionPermission,
    writeWorkflowScript,
  }) => {
    await seedSessionPermission("default", "full-access");
    const integrationFilePath = await writeWorkflowScript(
      "integration-pause-multiple.mjs",
      `
import { workflow } from "${
  librettoRuntimePath
}";

export const main = workflow({}, async (ctx) => {
  console.log("CHECKPOINT_0");
  await ctx.pause();
  console.log("CHECKPOINT_1");
  await ctx.pause();
  console.log("CHECKPOINT_2");
  await ctx.pause();
  console.log("CHECKPOINT_DONE");
});
`,
    );

    try {
      const runResult = await librettoCli(
        `run "${integrationFilePath}" main --session default --headless --debug`,
      );
      expect(runResult.exitCode).toBe(0);
      expect(runResult.stdout).toContain("CHECKPOINT_0");
      expect(runResult.stdout).toContain("Workflow paused.");
      expect(runResult.stdout).not.toContain("CHECKPOINT_1");
      expect(runResult.stdout).not.toContain("Integration completed.");

      const firstResume = await librettoCli("resume --session default");
      expect(firstResume.exitCode).toBe(0);
      expect(firstResume.stdout).toContain("CHECKPOINT_1");
      expect(firstResume.stdout).toContain("Workflow paused.");
      expect(firstResume.stdout).not.toContain("CHECKPOINT_2");
      expect(firstResume.stdout).not.toContain("Integration completed.");

      const secondResume = await librettoCli("resume --session default");
      expect(secondResume.exitCode).toBe(0);
      expect(secondResume.stdout).toContain("CHECKPOINT_2");
      expect(secondResume.stdout).toContain("Workflow paused.");
      expect(secondResume.stdout).not.toContain("CHECKPOINT_DONE");
      expect(secondResume.stdout).not.toContain("Integration completed.");

      const thirdResume = await librettoCli("resume --session default");
      expect(thirdResume.exitCode).toBe(0);
      expect(thirdResume.stdout).toContain("CHECKPOINT_DONE");
      expect(thirdResume.stdout).toContain("Integration completed.");
      expect(thirdResume.stdout).not.toContain("Workflow paused.");
    } finally {
      await librettoCli("close --session default");
    }
  }, 60_000);

  test("fails resume when session is not paused", async ({
    librettoCli,
    seedSessionState,
  }) => {
    await seedSessionState({ session: "default", mode: "full-access" });
    const result = await librettoCli("resume --session default");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Session "default" is not paused.');
  });

  test("open fails while paused workflow session is active, then resume continues", async ({
    librettoCli,
    librettoRuntimePath,
    seedSessionPermission,
    writeWorkflowScript,
  }) => {
    await seedSessionPermission("default", "full-access");
    const integrationFilePath = await writeWorkflowScript(
      "integration-pause-stale-artifacts.mjs",
      `
import { workflow } from "${
  librettoRuntimePath
}";

export const main = workflow({}, async (ctx) => {
  console.log("WORKFLOW_PAUSE_POINT");
  await ctx.pause();
  console.log("WORKFLOW_AFTER_RESUME");
});
`,
    );

    try {
      const runResult = await librettoCli(
        `run "${integrationFilePath}" main --session default --headless --debug`,
      );
      expect(runResult.exitCode).toBe(0);
      expect(runResult.stdout).toContain("WORKFLOW_PAUSE_POINT");
      expect(runResult.stdout).toContain("Workflow paused.");

      const openAttempt = await librettoCli(
        "open https://example.com --session default",
        { PATH: "/definitely-not-real" },
      );
      expect(openAttempt.exitCode).toBe(1);
      expect(openAttempt.stderr).toContain(
        'Session "default" is already open and connected to',
      );
      expect(openAttempt.stderr).toContain(
        "Create a new session or close the current one with: libretto-cli close --session default",
      );

      const resumeResult = await librettoCli("resume --session default");
      expect(resumeResult.exitCode).toBe(0);
      expect(resumeResult.stdout).toContain("WORKFLOW_AFTER_RESUME");
      expect(resumeResult.stdout).toContain("Integration completed.");
    } finally {
      await librettoCli("close --session default");
    }
  }, 60_000);
});
