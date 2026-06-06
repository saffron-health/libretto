import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Aff } from "../../src/v2/index.js";

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
