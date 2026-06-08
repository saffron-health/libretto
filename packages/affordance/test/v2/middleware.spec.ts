import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Aff } from "../../src/v2/index.js";

describe("Aff v2 middleware", () => {
  test("middleware wraps handler execution through next", async () => {
    const events: string[] = [];
    const app = Aff.cli("libretto")
      .use(
        Aff.middleware(async ({ next }) => {
          events.push("before");
          const result = await next();
          events.push("after");
          return result;
        }),
      )
      .routes({
        open: Aff.command({ description: "Open URL" }).handle(async () => {
          events.push("handler");
          return "opened";
        }),
      });

    await expect(app.exec("open")).resolves.toBe("opened");
    expect(events).toEqual(["before", "handler", "after"]);
  });

  test("next rejects with the original downstream handler error", async () => {
    const failure = new Error("handler failed");
    let observedError: unknown;
    const app = Aff.cli("libretto")
      .use(
        Aff.middleware(async ({ next }) => {
          try {
            return await next();
          } catch (error) {
            observedError = error;
            throw error;
          }
        }),
      )
      .routes({
        open: Aff.command({ description: "Open URL" }).handle(async () => {
          throw failure;
        }),
      });

    await expect(app.exec("open")).rejects.toBe(failure);
    expect(observedError).toBe(failure);
  });

  test("middleware can short-circuit by returning without calling next", async () => {
    let handlerCalls = 0;
    const app = Aff.cli("libretto")
      .use(Aff.middleware(async () => "cached"))
      .routes({
        open: Aff.command({ description: "Open URL" }).handle(async () => {
          handlerCalls += 1;
          return "opened";
        }),
      });

    await expect(app.exec("open")).resolves.toBe("cached");
    expect(handlerCalls).toBe(0);
  });

  test("root, group, and command middleware wrap the handler in structural order", async () => {
    const events: string[] = [];
    const app = Aff.cli("libretto")
      .use(
        Aff.middleware(async ({ next }) => {
          events.push("root before");
          const result = await next({ ctx: { root: true } });
          events.push("root after");
          return result;
        }),
      )
      .routes({
        cloud: Aff.group({ description: "Cloud commands" })
          .use(
            Aff.middleware(async ({ ctx, next }) => {
              events.push(`group before ${String((ctx as { root?: boolean }).root)}`);
              const result = await next({ ctx: { group: true } });
              events.push("group after");
              return result;
            }),
          )
          .routes({
            login: Aff.command({ description: "Log in" })
              .use(
                Aff.middleware(async ({ ctx, next }) => {
                  const commandContext = ctx as {
                    root?: boolean;
                    group?: boolean;
                  };
                  events.push(
                    `command before ${String(commandContext.root)} ${String(commandContext.group)}`,
                  );
                  const result = await next({ ctx: { command: true } });
                  events.push("command after");
                  return result;
                }),
              )
              .handle(async ({ ctx }) => {
                events.push(
                  `handler ${JSON.stringify(ctx, Object.keys(ctx as Record<string, unknown>).sort())}`,
                );
                return ctx;
              }),
          }),
      });

    await expect(app.invoke("cloud.login", [], {}, { initial: true })).resolves.toEqual({
      initial: true,
      root: true,
      group: true,
      command: true,
    });
    expect(events).toEqual([
      "root before",
      "group before true",
      "command before true true",
      'handler {"command":true,"group":true,"initial":true,"root":true}',
      "command after",
      "group after",
      "root after",
    ]);
  });

  test("root middleware does not run for help, group help, unknown commands, or input validation failures", async () => {
    let middlewareCalls = 0;
    const app = Aff.cli("libretto")
      .use(
        Aff.middleware(async ({ next }) => {
          middlewareCalls += 1;
          return next();
        }),
      )
      .routes({
        cloud: Aff.group({ description: "Cloud commands" }).routes({
          login: Aff.command({ description: "Log in" })
            .arguments([["url", z.url()]])
            .handle(async () => "logged in"),
        }),
      });

    await expect(app.exec("help")).resolves.toContain("Usage: libretto <command>");
    await expect(app.exec("cloud")).resolves.toContain("Usage: libretto cloud <subcommand>");
    await expect(app.exec("missing")).rejects.toThrow("Unknown command: missing");
    await expect(app.exec("cloud login not-a-url")).rejects.toThrow("Invalid URL");
    expect(middlewareCalls).toBe(0);
  });

  test("described middleware builder creates middleware", async () => {
    const app = Aff.cli("libretto")
      .use(
        Aff.middleware({ description: "record command" }).handle(async ({ command, next }) => {
          const result = await next();
          return { command: command.routeKey, result };
        }),
      )
      .routes({
        open: Aff.command({ description: "Open URL" }).handle(async () => "opened"),
      });

    await expect(app.exec("open")).resolves.toEqual({
      command: "open",
      result: "opened",
    });
  });
});
