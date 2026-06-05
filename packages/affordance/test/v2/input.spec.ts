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

  test.todo("parses arguments and options from an exec string");
});
