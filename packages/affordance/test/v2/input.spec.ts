import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Aff } from "../../src/v2/index.js";

describe("Aff v2 input", () => {
  test("parses positional arguments and named options from raw invoke input", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "open" })
        .arguments([["url", z.string()]])
        .options({
          session: Aff.option(z.string().default("default")),
          headed: Aff.flag(),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.invoke("open", {
        positionals: ["https://example.com"],
        named: { headed: true },
      }),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "default",
      headed: true,
    });
  });

  test("parses positional arguments and named options from an exec string", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "open" })
        .arguments([["url", z.string()]])
        .options({
          session: Aff.option(z.string().default("default")),
          headed: Aff.flag(),
        })
        .handle(async ({ input }) => input),
    });

    await expect(
      app.exec("open https://example.com --session debug --headed"),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
      headed: true,
    });
  });

  test("surfaces input validation errors before middleware runs", async () => {
    let middlewareRan = false;

    const app = Aff.cli("libretto")
      .use(async ({ next }) => {
        middlewareRan = true;
        return next();
      })
      .routes({
        open: Aff.command({ description: "open" })
          .arguments([["url", z.string().url()]])
          .handle(async () => "opened"),
      });

    await expect(app.exec("open not-a-url")).rejects.toThrow();
    expect(middlewareRan).toBe(false);
  });
});
