import { describe, expect, test } from "vitest";
import { benchmarkHooks } from "../benchmarks/shared/hooks.js";
import { solveCaptchaHooks } from "../benchmarks/shared/solve-captcha-tool.js";

describe("benchmark hooks", () => {
  test("rewrites background Bash commands to foreground", async () => {
    const callback = benchmarkHooks.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();

    const output = await callback!(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/tmp/workspace",
        tool_name: "Bash",
        tool_input: {
          command: "echo hello",
          run_in_background: true,
          timeout: 10_000,
        },
        tool_use_id: "toolu_123",
      },
      "toolu_123",
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({
      continue: true,
      systemMessage:
        "<system-message>run_in_background is not allowed for Bash in benchmarks.</system-message>",
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "Foreground execution is required for benchmark Bash commands.",
        updatedInput: {
          command: "echo hello",
          run_in_background: false,
          timeout: 10_000,
        },
      },
    });
  });

  test("includes solve-captcha failure hooks", () => {
    expect(benchmarkHooks.PostToolUseFailure).toBe(
      solveCaptchaHooks.PostToolUseFailure,
    );
  });
});
