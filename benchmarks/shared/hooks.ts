import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { solveCaptchaHooks } from "./solve-captcha-tool.js";

const BASH_TOOL_NAME = "Bash";
const FOREGROUND_ENFORCEMENT_NOTE =
  "<system-message>run_in_background is not allowed for Bash in benchmarks.</system-message>";

type BenchmarkHookSet = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

export const bashForegroundHooks: BenchmarkHookSet = {
  PreToolUse: [
    {
      matcher: BASH_TOOL_NAME,
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") {
            return {};
          }

          if (input.tool_name !== BASH_TOOL_NAME) {
            return {};
          }

          if (!input.tool_input || typeof input.tool_input !== "object") {
            return {};
          }

          const toolInput = input.tool_input as Record<string, unknown>;
          if (toolInput.run_in_background !== true) {
            return {};
          }

          return {
            continue: true,
            systemMessage: FOREGROUND_ENFORCEMENT_NOTE,
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              permissionDecisionReason:
                "Foreground execution is required for benchmark Bash commands.",
              updatedInput: {
                ...toolInput,
                run_in_background: false,
              },
            },
          };
        },
      ],
    },
  ],
};

export const benchmarkHooks: BenchmarkHookSet = {
  ...solveCaptchaHooks,
  ...bashForegroundHooks,
};
