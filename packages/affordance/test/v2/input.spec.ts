import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Aff } from "../../src/v2/index.js";

function testStandardSchema<TInput, TOutput>(
  validate: (
    value: unknown,
  ) => StandardSchemaV1.Result<TOutput> | Promise<StandardSchemaV1.Result<TOutput>>,
): StandardSchemaV1<TInput, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "affordance-test",
      validate,
    },
  };
}

describe("Aff v2 input", () => {
  test("parses arguments and options from invoke input", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string().default("default")),
          retries: z.coerce.number().int().default(0),
          headless: Aff.flag(),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.invoke("open", ["https://example.com"], {
        session: "debug",
        retries: "2",
        headless: true,
      }),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      retries: 2,
      headless: true,
    });

    await expect(app.invoke("open", ["https://example.com"], {})).resolves.toEqual({
      url: "https://example.com",
      session: "default",
      retries: 0,
      headless: false,
    });
  });

  test("surfaces input validation errors before the handler runs", async () => {
    let handlerCalls = 0;
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string().min(1)),
        })
        .handle(async () => {
          handlerCalls += 1;
        }),
    });

    await expect(
      app.invoke("open", ["not-a-url"], {
        session: "debug",
      }),
    ).rejects.toThrow("Invalid URL");
    expect(handlerCalls).toBe(0);
  });

  test("parses arguments and options declared with non-Zod Standard Schema validators", async () => {
    const pathSchema = testStandardSchema<string, { path: string }>((value) => {
      if (typeof value === "string" && value.length > 0) {
        return { value: { path: value } };
      }

      return { issues: [{ message: "Expected a non-empty path" }] };
    });
    const countSchema = testStandardSchema<string, number>((value) => {
      if (typeof value === "string" && /^\d+$/.test(value)) {
        return { value: Number(value) };
      }

      return { issues: [{ message: "Expected a numeric count" }] };
    });
    const labelSchema = testStandardSchema<string | undefined, string>((value) => {
      if (typeof value === "string" && value.length > 0) {
        return { value };
      }

      if (value === undefined) {
        return { value: "default" };
      }

      return { issues: [{ message: "Expected a label" }] };
    });

    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "Run workflow" })
        .arguments([["workflow", pathSchema]])
        .options({
          count: countSchema,
          label: Aff.option(labelSchema),
        })
        .handle(async ({ input }) => input),
    });

    await expect(app.exec("run workflows/smoke.ts --count 3")).resolves.toEqual({
      workflow: { path: "workflows/smoke.ts" },
      count: 3,
      label: "default",
    });
  });

  test("awaits asynchronous Standard Schema validation", async () => {
    const tokenSchema = testStandardSchema<string, { token: string }>(async (value) => {
      if (value === "valid-token") {
        return { value: { token: "valid-token" } };
      }

      return { issues: [{ message: "Expected a valid token" }] };
    });

    const app = Aff.cli("libretto").routes({
      auth: Aff.command({ description: "Authenticate" })
        .options({
          token: Aff.option(tokenSchema),
        })
        .handle(async ({ input }) => input),
    });

    await expect(app.exec("auth --token valid-token")).resolves.toEqual({
      token: { token: "valid-token" },
    });
    await expect(app.exec("auth --token invalid-token")).rejects.toThrow("Expected a valid token");
  });

  test("parses arguments and options from an exec string", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string().default("default")),
          retries: z.coerce.number().int().default(0),
          headless: Aff.flag(),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.exec("open https://example.com --session debug --retries 2 --headless"),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      retries: 2,
      headless: true,
    });

    await expect(app.exec("open https://example.com")).resolves.toEqual({
      url: "https://example.com",
      session: "default",
      retries: 0,
      headless: false,
    });
  });

  test("parses inline option values and explicit flag values from an exec string", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string()),
          headless: Aff.flag(),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.exec("open https://example.com --session=debug --headless=false"),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      headless: false,
    });
  });

  test("parses named option aliases from exec and invoke input", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string().default("default"), { aliases: ["s"] }),
          headless: Aff.flag({ aliases: ["H"] }),
        })
        .handle(async ({ input }) => input),
    });

    await expect(app.exec("open https://example.com -s debug -H")).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      headless: true,
    });

    await expect(app.invoke("open", ["https://example.com"], { s: "debug" })).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      headless: false,
    });
  });

  test("rejects duplicate named option aliases", async () => {
    expect(() =>
      Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string(), { aliases: ["s"] }),
          scope: Aff.option(z.string(), { aliases: ["s"] }),
        }),
    ).toThrow("Duplicate option alias --s for --session and --scope.");
  });

  test("parses quoted command-line arguments and option values", async () => {
    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "Run workflow" })
        .arguments([["workflow", z.string()]])
        .options({
          label: Aff.option(z.string()),
          params: Aff.option(z.string()),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.exec(
        'run "workflows/my flow.ts" --label "smoke test" --params=\'{"url":"https://example.com"}\'',
      ),
    ).resolves.toEqual({
      workflow: "workflows/my flow.ts",
      label: "smoke test",
      params: '{"url":"https://example.com"}',
    });
  });

  test("surfaces command-line input errors before the handler runs", async () => {
    let handlerCalls = 0;
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .arguments([["url", z.url()]])
        .options({
          session: Aff.option(z.string()),
        })
        .handle(async () => {
          handlerCalls += 1;
        }),
      status: Aff.command({ description: "Show status" }).handle(async () => {
        handlerCalls += 1;
      }),
    });

    await expect(app.exec("open --session debug")).rejects.toThrow(
      "Missing required argument <url>.",
    );
    await expect(app.exec("open https://example.com")).rejects.toThrow(
      "Missing required option --session.",
    );
    await expect(app.exec("open https://example.com --unknown value")).rejects.toThrow(
      "Unknown option: --unknown",
    );
    await expect(app.exec("open https://example.com --toString value")).rejects.toThrow(
      "Unknown option: --toString",
    );
    await expect(app.exec("open https://example.com --session")).rejects.toThrow(
      "Missing value for --session.",
    );
    await expect(app.exec("open https://example.com extra --session debug")).rejects.toThrow(
      "Unexpected arguments for libretto open.",
    );
    await expect(app.exec("status extra")).rejects.toThrow(
      "Unexpected arguments for libretto status.",
    );
    expect(handlerCalls).toBe(0);
  });
});
