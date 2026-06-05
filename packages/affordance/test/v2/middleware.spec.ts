import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Aff, type AffMiddleware } from "../../src/v2/index.js";

describe("Aff v2 middleware", () => {
  test("middleware wraps handler execution through next", async () => {
    const order: string[] = [];
    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "run" })
        .use(async ({ next }) => {
          order.push("before");
          const result = await next();
          order.push("after");
          return result;
        })
        .handle(async () => {
          order.push("handler");
          return "ok";
        }),
    });

    await expect(
      app.invoke("run", { positionals: [], named: {} }),
    ).resolves.toBe("ok");
    expect(order).toEqual(["before", "handler", "after"]);
  });

  test("next rejects with the original downstream handler error", async () => {
    const handlerError = new Error("handler failed");
    let observedError: unknown = null;

    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "run" })
        .use(async ({ next }) => {
          try {
            return await next();
          } catch (error) {
            observedError = error;
            throw error;
          }
        })
        .handle(async () => {
          throw handlerError;
        }),
    });

    await expect(
      app.invoke("run", { positionals: [], named: {} }),
    ).rejects.toBe(handlerError);
    expect(observedError).toBe(handlerError);
  });

  test("middleware can short-circuit by returning without calling next", async () => {
    let handlerRan = false;

    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "run" })
        .use(async () => "short-circuited")
        .handle(async () => {
          handlerRan = true;
          return "handler";
        }),
    });

    await expect(
      app.invoke("run", { positionals: [], named: {} }),
    ).resolves.toBe("short-circuited");
    expect(handlerRan).toBe(false);
  });

  test("root, group, and command middleware wrap the handler in structural order", async () => {
    const order: string[] = [];

    const rootMiddleware: AffMiddleware = async ({ next }) => {
      order.push("root before");
      const result = await next();
      order.push("root after");
      return result;
    };
    const groupMiddleware: AffMiddleware = async ({ next }) => {
      order.push("group before");
      const result = await next({ ctx: { fromGroup: true } });
      order.push("group after");
      return result;
    };
    const commandMiddleware: AffMiddleware = async ({ ctx, next }) => {
      order.push("command before");
      expect(ctx.fromGroup).toBe(true);
      const result = await next({ ctx: { fromCommand: true } });
      order.push("command after");
      return result;
    };

    const app = Aff.cli("libretto")
      .use(rootMiddleware)
      .routes({
        ai: Aff.group({ description: "AI commands" })
          .use(groupMiddleware)
          .routes({
            configure: Aff.command({ description: "configure" })
              .use(commandMiddleware)
              .handle(async ({ ctx }) => {
                order.push("handler");
                expect(ctx.fromGroup).toBe(true);
                expect(ctx.fromCommand).toBe(true);
                return "ok";
              }),
          }),
      });

    await expect(
      app.invoke("ai.configure", { positionals: [], named: {} }),
    ).resolves.toBe("ok");
    expect(order).toEqual([
      "root before",
      "group before",
      "command before",
      "handler",
      "command after",
      "group after",
      "root after",
    ]);
  });

  test("root middleware does not run for help, group help, unknown commands, or input validation failures", async () => {
    let rootRuns = 0;

    const app = Aff.cli("libretto")
      .use(async ({ next }) => {
        rootRuns += 1;
        return next();
      })
      .routes({
        ai: Aff.group({ description: "AI commands" }).routes({
          configure: Aff.command({ description: "configure" })
            .handle(async () => "configured"),
        }),
        open: Aff.command({ description: "open" })
          .arguments([["url", z.string()]])
          .handle(async () => "opened"),
      });

    await expect(app.exec("help")).resolves.toContain("Usage: libretto");
    await expect(app.exec("ai")).resolves.toContain(
      "Usage: libretto ai <subcommand>",
    );
    await expect(app.exec("opne")).rejects.toThrow("Unknown command: opne");
    await expect(app.exec("open")).rejects.toThrow(
      "Missing required argument <url>.",
    );
    expect(rootRuns).toBe(0);

    await expect(app.exec("open https://example.com")).resolves.toBe(
      "opened",
    );
    expect(rootRuns).toBe(1);
  });

  test("described middleware builder creates middleware", async () => {
    const middleware = Aff.middleware({ description: "wrap" }).handle(
      async ({ next }) => {
        const result = await next();
        return `${result} wrapped`;
      },
    );

    const app = Aff.cli("libretto").routes({
      run: Aff.command({ description: "run" })
        .use(middleware)
        .handle(async () => "ok"),
    });

    await expect(
      app.invoke("run", { positionals: [], named: {} }),
    ).resolves.toBe("ok wrapped");
  });
});
