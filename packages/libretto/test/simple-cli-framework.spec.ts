import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  type SimpleCLIParserAdapter,
  SimpleCLI,
} from "../src/cli/framework/simple-cli.js";

describe("SimpleCLI phase 1 primitives", () => {
  test("derives route keys and path tokens from tree keys", () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const noop = SimpleCLI.command({ help: "noop" }).input(noInput).handle(async () => {});

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.group({
        configure: noop,
      }),
      open: noop,
    });

    const commands = app.getCommands();
    expect(commands).toHaveLength(2);
    expect(commands.map((command) => command.routeKey)).toEqual([
      "ai.configure",
      "open",
    ]);
    expect(commands.map((command) => command.path.join(" "))).toEqual([
      "ai configure",
      "open",
    ]);
  });

  test("parses named + positional input from one declaration and supports refine", () => {
    const runInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("integrationFile", z.string().min(1)),
        SimpleCLI.positional("integrationExport", z.string().min(1)),
      ],
      named: {
        session: SimpleCLI.option(z.string().default("default")),
        params: SimpleCLI.option(z.string().optional()),
        paramsFile: SimpleCLI.option(z.string().optional(), {
          name: "params-file",
        }),
        headed: SimpleCLI.flag(),
        headless: SimpleCLI.flag(),
      },
    })
      .refine((value) => !(value.params && value.paramsFile), "Pass either --params or --params-file, not both.")
      .refine((value) => !(value.headed && value.headless), "Cannot pass both --headed and --headless.");

    const parsed = runInput.parse({
      positionals: ["./integration.ts", "main"],
      named: {
        session: "debug-session",
        "params-file": "./params.json",
      },
    });

    expect(parsed).toEqual({
      integrationFile: "./integration.ts",
      integrationExport: "main",
      session: "debug-session",
      headless: false,
      headed: false,
      params: undefined,
      paramsFile: "./params.json",
    });
  });

  test("runs group middleware before command middleware and passes context to handler", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const executionOrder: string[] = [];
    let handlerContext: Record<string, unknown> | null = null;

    const groupMiddleware = async ({ ctx }: { ctx: Record<string, unknown> }) => {
      executionOrder.push("group");
      return { ...ctx, fromGroup: true };
    };
    const commandMiddleware = async ({ ctx }: { ctx: Record<string, unknown> }) => {
      executionOrder.push("command");
      return { ...ctx, fromCommand: true };
    };

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.use(groupMiddleware).group({
        configure: SimpleCLI.command({ help: "configure" })
          .input(noInput)
          .use(commandMiddleware)
          .handle(async ({ ctx }) => {
            executionOrder.push("handler");
            handlerContext = ctx;
          }),
      }),
    });

    await app.invoke("ai.configure", { positionals: [], named: {} });

    expect(executionOrder).toEqual(["group", "command", "handler"]);
    expect(handlerContext).toEqual({
      fromGroup: true,
      fromCommand: true,
    });
  });

  test("propagates middleware errors and does not run handler on failure", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    let handlerRan = false;
    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.use(() => {
        throw new Error("middleware failed");
      }).group({
        configure: SimpleCLI.command({ help: "configure" })
          .input(noInput)
          .handle(async () => {
            handlerRan = true;
          }),
      }),
    });

    await expect(
      app.invoke("ai.configure", { positionals: [], named: {} }),
    ).rejects.toThrow("middleware failed");
    expect(handlerRan).toBe(false);
  });

  test("runs through parser adapter seam", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const observed: { args: readonly string[]; routeKeys: string[] }[] = [];
    const adapter: SimpleCLIParserAdapter = {
      parse(args, commands) {
        observed.push({
          args,
          routeKeys: commands.map((command) => command.routeKey),
        });
        return {
          routeKey: "open",
          positionals: [],
          named: {},
        };
      },
    };

    const app = SimpleCLI.define("libretto", {
      open: SimpleCLI.command({ help: "open" })
        .input(noInput)
        .handle(async () => "ok"),
    });

    const result = await app.run(["open"], adapter);
    expect(result).toBe("ok");
    expect(observed).toEqual([
      {
        args: ["open"],
        routeKeys: ["open"],
      },
    ]);
  });
});
