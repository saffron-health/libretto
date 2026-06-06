import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  mergeCredentialsIntoInput,
  readCredentialInputsFromEnv,
} from "../src/shared/workflow/credentials.js";
import { workflow } from "../src/shared/workflow/workflow.js";

describe("credential input injection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves hosted injected credentials over local env values", () => {
    const input = mergeCredentialsIntoInput(
      {
        credentials: {
          openai_api_key: "hosted-openai",
          anthropic_api_key: "hosted-anthropic",
        },
      },
      ["openai_api_key"],
    );

    expect(input).toMatchObject({
      credentials: {
        openai_api_key: "hosted-openai",
      },
    });
  });

  it("reads non-empty LIBRETTO_CLOUD env vars into credential input names", () => {
    expect(
      readCredentialInputsFromEnv({
        LIBRETTO_CLOUD_OPENAI_API_KEY: "local-openai",
        LIBRETTO_CLOUD_EMPTY: "",
        LIBRETTO_CLOUD_SPACES: "   ",
        LIBRETTO_CLOUD_API_KEY: "control-key",
        OPENAI_API_KEY: "ignored",
      }),
    ).toEqual({
      openai_api_key: "local-openai",
    });
  });

  it("injects local credential env vars into workflow input after strict validation", async () => {
    vi.stubEnv("LIBRETTO_CLOUD_OPENAI_API_KEY", "local-openai");
    vi.stubEnv("NODE_ENV", "development");
    const wf = workflow(
      "credentialed",
      {
        credentials: ["openai_api_key"],
        input: z.object({ prompt: z.string() }).strict(),
      },
      async (_ctx, input) => input,
    );

    const output = await wf.run({ session: "test", page: {} as never }, {
      prompt: "hello",
    });

    expect(output).toEqual({
      prompt: "hello",
      credentials: { openai_api_key: "local-openai" },
    });
  });

  it("injects local credential env vars when NODE_ENV is production without hosted runtime", async () => {
    vi.stubEnv("LIBRETTO_CLOUD_OPENAI_API_KEY", "local-openai");
    vi.stubEnv("NODE_ENV", "production");
    const wf = workflow(
      "credentialed",
      {
        credentials: ["openai_api_key"],
        input: z.object({ prompt: z.string() }).strict(),
      },
      async (_ctx, input) => input,
    );

    const output = await wf.run({ session: "test", page: {} as never }, {
      prompt: "hello",
    });

    expect(output).toEqual({
      prompt: "hello",
      credentials: { openai_api_key: "local-openai" },
    });
  });

  it("does not inject credential env vars in hosted runtime", async () => {
    vi.stubEnv("LIBRETTO_CLOUD_OPENAI_API_KEY", "local-openai");
    vi.stubEnv("LIBRETTO_HOSTED_RUNTIME", "true");
    vi.stubEnv("NODE_ENV", "development");
    const wf = workflow(
      "credentialed",
      {
        credentials: ["openai_api_key"],
        input: z.object({ prompt: z.string() }).strict(),
      },
      async (_ctx, input) => input,
    );

    const output = await wf.run({ session: "test", page: {} as never }, {
      prompt: "hello",
    });

    expect(output).toEqual({
      prompt: "hello",
    });
  });

  it("preserves hosted injected credentials in hosted runtime", async () => {
    vi.stubEnv("LIBRETTO_CLOUD_OPENAI_API_KEY", "local-openai");
    vi.stubEnv("LIBRETTO_HOSTED_RUNTIME", "true");
    const wf = workflow(
      "credentialed",
      {
        credentials: ["openai_api_key"],
        input: z.object({ prompt: z.string() }).strict(),
      },
      async (_ctx, input) => input,
    );

    const output = await wf.run({ session: "test", page: {} as never }, {
      prompt: "hello",
      credentials: { openai_api_key: "hosted-openai" },
    });

    expect(output).toEqual({
      prompt: "hello",
      credentials: { openai_api_key: "hosted-openai" },
    });
  });

  it("does not inject local credential env vars without a workflow declaration", async () => {
    vi.stubEnv("LIBRETTO_CLOUD_OPENAI_API_KEY", "local-openai");
    vi.stubEnv("NODE_ENV", "development");
    const wf = workflow(
      "credentialed",
      {
        input: z.object({ prompt: z.string() }).strict(),
      },
      async (_ctx, input) => input,
    );

    const output = await wf.run({ session: "test", page: {} as never }, {
      prompt: "hello",
    });

    expect(output).toEqual({
      prompt: "hello",
    });
  });
});
