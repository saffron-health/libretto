import { describe, expect, test } from "vitest";
import {
  SOLVE_CAPTCHA_TOOL_NAME,
  createSolveCaptchaHooks,
  waitForSolveCaptchaTarget,
} from "../benchmarks/shared/solve-captcha-tool.js";

function createPollingPage(states: Array<{ url: string; title: string }>) {
  let index = 0;
  return {
    url() {
      return states[Math.min(index, states.length - 1)]!.url;
    },
    async title() {
      return states[Math.min(index, states.length - 1)]!.title;
    },
    async waitForTimeout() {
      if (index < states.length - 1) {
        index += 1;
      }
    },
  };
}

describe("benchmark solve-captcha tool", () => {
  test("waits until the page reaches the requested URL/title target", async () => {
    const page = createPollingPage([
      {
        url: "https://dictionary.cambridge.org/search/direct/?datasetsearch=british-grammar&q=fewer+and+less",
        title: "Just a moment...",
      },
      {
        url: "https://dictionary.cambridge.org/grammar/british-grammar/fewer-or-less",
        title: "Less or fewer ? - Grammar - Cambridge Dictionary",
      },
    ]);

    const result = await waitForSolveCaptchaTarget(page, {
      session: "webvoyager-cambridge-dictionary-32",
      waitForUrlIncludes: "/grammar/british-grammar/fewer-or-less",
      waitForTitleIncludes: "Cambridge Dictionary",
      timeoutSeconds: 2,
    });

    expect(result.snapshot.url).toContain("/grammar/british-grammar/fewer-or-less");
    expect(result.snapshot.title).toContain("Cambridge Dictionary");
  });

  test("fails clearly when the expected page never arrives", async () => {
    const page = createPollingPage([
      {
        url: "https://dictionary.cambridge.org/search/direct/?datasetsearch=british-grammar&q=fewer+and+less",
        title: "Just a moment...",
      },
      {
        url: "https://dictionary.cambridge.org/search/direct/?datasetsearch=british-grammar&q=fewer+and+less",
        title: "Just a moment...",
      },
    ]);

    await expect(
      waitForSolveCaptchaTarget(page, {
        session: "webvoyager-cambridge-dictionary-32",
        waitForUrlIncludes: "/grammar/british-grammar/fewer-or-less",
        timeoutSeconds: 1,
      }),
    ).rejects.toThrow("Stuck on Captcha");
  });

  test("failure hook stops the harness on solve-captcha timeout", async () => {
    const hooks = createSolveCaptchaHooks();
    const callback = hooks.PostToolUseFailure[0]!.hooks[0]!;

    const output = await callback(
      {
        hook_event_name: "PostToolUseFailure",
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/tmp/workspace",
        tool_name: SOLVE_CAPTCHA_TOOL_NAME,
        tool_input: {
          session: "webvoyager-cambridge-dictionary-32",
          waitForUrlIncludes: "/grammar/british-grammar/fewer-or-less",
        },
        tool_use_id: "toolu_123",
        error: "Stuck on Captcha after 60s.",
      },
      "toolu_123",
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({
      continue: false,
      stopReason: "Stuck on Captcha",
      systemMessage: "<system-message>Stuck on Captcha</system-message>",
    });
  });
});
