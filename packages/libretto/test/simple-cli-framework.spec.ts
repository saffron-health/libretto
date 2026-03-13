import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  type SimpleCLIParserAdapter,
  SimpleCLI,
} from "../src/cli/framework/simple-cli.js";

const group = <TRoutes extends Parameters<typeof SimpleCLI.group>[0]>(
  config: { description: string },
  routes: TRoutes,
) =>
  Object.assign(SimpleCLI.group(routes), config);

const command = (config: { description: string }) =>
  SimpleCLI.command(
    config as unknown as Parameters<typeof SimpleCLI.command>[0],
  );

describe("SimpleCLI framework", () => {
  test("derives route keys and path tokens from tree keys", () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const noop = command({ description: "noop" }).input(noInput).handle(async () => {});

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
        configure: command({ description: "configure" })
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
        configure: command({ description: "configure" })
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
      open: command({ description: "open" })
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

  test("renders root and group help from route paths and descriptions", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const app = SimpleCLI.define("libretto-cli", {
      ai: group({ description: "AI commands" }, {
        configure: command({
          description: "Configure AI runtime",
        })
          .input(noInput)
          .handle(async () => {}),
      }),
      open: command({ description: "Launch browser and open URL" })
        .input(noInput)
        .handle(async () => {}),
    });

    const adapter: SimpleCLIParserAdapter = {
      parse() {
        throw new Error("help should bypass parser adapter");
      },
    };

    const rootHelp = await app.run(["help"], adapter);
    expect(rootHelp).toBe(
      [
        "Usage: libretto-cli <command>",
        "",
        "Commands:",
        "  ai <subcommand>  AI commands",
        "  open  Launch browser and open URL",
      ].join("\n"),
    );

    const groupHelp = await app.run(["help", "ai"], adapter);
    expect(groupHelp).toBe(
      [
        "AI commands",
        "",
        "Usage: libretto-cli ai <subcommand>",
        "",
        "Commands:",
        "  configure  Configure AI runtime",
      ].join("\n"),
    );
  });

  test("renders command help from the route path description and parameters", async () => {
    const aiConfigureInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("preset", z.enum(["codex", "claude", "gemini"]).optional(), {
          help: "AI preset",
        }),
      ],
      named: {
        provider: SimpleCLI.option(z.string().optional(), {
          help: "Provider override",
        }),
        clear: SimpleCLI.flag({ help: "Clear existing AI config" }),
        passthrough: SimpleCLI.option(z.array(z.string()).default([]), {
          source: "--",
          help: "Command prefix after --",
        }),
      },
    });

    const app = SimpleCLI.define("libretto-cli", {
      ai: group({ description: "AI commands" }, {
        configure: command({
          description: "Configure AI runtime",
        })
          .input(aiConfigureInput)
          .handle(async () => {}),
      }),
    });

    const adapter: SimpleCLIParserAdapter = {
      parse() {
        throw new Error("help should bypass parser adapter");
      },
    };

    const helpFromCommand = await app.run(["help", "ai", "configure"], adapter);
    expect(helpFromCommand).toBe(
      [
        "Configure AI runtime",
        "",
        "Usage: libretto-cli ai configure [preset] [options]",
        "",
        "Arguments:",
        "  [preset]  AI preset",
        "",
        "Options:",
        "  --provider <value>  Provider override",
        "  --clear  Clear existing AI config",
        "  -- <args...>  Command prefix after --",
      ].join("\n"),
    );

    const helpFromFlag = await app.run(["ai", "configure", "--help"], adapter);
    expect(helpFromFlag).toBe(helpFromCommand);
  });
});
