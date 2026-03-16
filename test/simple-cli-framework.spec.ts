import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  SimpleCLI,
  type SimpleCLIMiddleware,
} from "../src/cli/framework/simple-cli.js";

describe("SimpleCLI framework", () => {
  test("derives route keys and path tokens from tree keys", () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const noop = SimpleCLI.command({ description: "noop" })
      .input(noInput)
      .handle(async () => {});

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.group({
        routes: {
          configure: noop,
        },
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

    const groupMiddleware: SimpleCLIMiddleware<
      unknown,
      {},
      { fromGroup: true }
    > = async ({ ctx }) => {
      executionOrder.push("group");
      return { ...ctx, fromGroup: true };
    };
    const commandMiddleware: SimpleCLIMiddleware<
      unknown,
      { fromGroup: true },
      { fromGroup: true; fromCommand: true }
    > = async ({ ctx }) => {
      executionOrder.push("command");
      const fromGroup: true = ctx.fromGroup;
      expect(fromGroup).toBe(true);
      return { ...ctx, fromCommand: true };
    };
    const ai = SimpleCLI.use(groupMiddleware);

    const app = SimpleCLI.define("libretto", {
      ai: ai.group({
        routes: {
          configure: ai.command({ description: "configure" })
            .input(noInput)
            .use(commandMiddleware)
            .handle(async ({ ctx }) => {
              executionOrder.push("handler");
              const fromGroup: true = ctx.fromGroup;
              const fromCommand: true = ctx.fromCommand;
              expect(fromGroup).toBe(true);
              expect(fromCommand).toBe(true);
              handlerContext = ctx;
            }),
        },
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
        routes: {
          configure: SimpleCLI.command({ description: "configure" })
            .input(noInput)
            .handle(async () => {
              handlerRan = true;
            }),
        },
      }),
    });

    await expect(
      app.invoke("ai.configure", { positionals: [], named: {} }),
    ).rejects.toThrow("middleware failed");
    expect(handlerRan).toBe(false);
  });

  test("typed middleware context is available on scoped command handlers", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const validateSession: SimpleCLIMiddleware<
      unknown,
      {},
      { sessionState: { id: string } }
    > = async ({ ctx }) => ({
        ...ctx,
        sessionState: { id: "default" },
      });
    const withSession = SimpleCLI.use(validateSession);

    let sessionId: string | null = null;
    const app = SimpleCLI.define("libretto", {
      open: withSession.command({ description: "open" })
        .input(noInput)
        .handle(async ({ ctx }) => {
          const sessionIdFromContext: string = ctx.sessionState.id;
          // @ts-expect-error scoped middleware should not inject unrelated keys
          ctx.fromCommand;
          expect(sessionIdFromContext).toBe("default");
          sessionId = ctx.sessionState.id;
        }),
    });

    await app.invoke("open", { positionals: [], named: {} });

    expect(sessionId).toBe("default");
  });

  test("parses command args with built-in option and passthrough handling", async () => {
    const aiConfigureInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("preset", z.enum(["codex", "claude", "gemini"]).optional()),
      ],
      named: {
        provider: SimpleCLI.option(z.string().optional()),
        clear: SimpleCLI.flag(),
        passthrough: SimpleCLI.option(z.array(z.string()).default([]), {
          source: "--",
        }),
      },
    });

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.group({
        description: "AI commands",
        routes: {
          configure: SimpleCLI.command({ description: "Configure AI runtime" })
            .input(aiConfigureInput)
            .handle(async ({ input }) => input),
        },
      }),
    });

    const result = await app.run([
      "ai",
      "configure",
      "codex",
      "--provider",
      "openai",
      "--clear",
      "--",
      "node",
      "./agent.js",
    ]);

    expect(result).toEqual({
      preset: "codex",
      provider: "openai",
      clear: true,
      passthrough: ["node", "./agent.js"],
    });
  });

  test("does not treat help flags after passthrough as CLI help", async () => {
    const aiConfigureInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("preset", z.string().optional()),
      ],
      named: {
        passthrough: SimpleCLI.option(z.array(z.string()).default([]), {
          source: "--",
        }),
      },
    });

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.group({
        description: "AI commands",
        routes: {
          configure: SimpleCLI.command({ description: "Configure AI runtime" })
            .input(aiConfigureInput)
            .handle(async ({ input }) => input),
        },
      }),
    });

    const result = await app.run([
      "ai",
      "configure",
      "openai",
      "--",
      "--help",
    ]);

    expect(result).toEqual({
      preset: "openai",
      passthrough: ["--help"],
    });
  });

  test("parses named option aliases and applies defaults", async () => {
    const openInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("url", z.string()),
      ],
      named: {
        session: SimpleCLI.option(z.string().default("default"), {
          aliases: ["s"],
        }),
        headless: SimpleCLI.flag({
          aliases: ["x"],
        }),
      },
    });

    const app = SimpleCLI.define("libretto", {
      open: SimpleCLI.command({ description: "open" })
        .input(openInput)
        .handle(async ({ input }) => input),
    });

    const result = await app.run(["open", "https://example.com", "-s", "debug", "-x"]);

    expect(result).toEqual({
      url: "https://example.com",
      session: "debug",
      headless: true,
    });
  });

  test("accepts global options before commands and injects them only when declared", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const openInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("url", z.string()),
      ],
      named: {
        session: SimpleCLI.option(z.string().default("default")),
      },
    });

    const app = SimpleCLI.define("libretto", {
      ai: SimpleCLI.group({
        routes: {
          configure: SimpleCLI.command({ description: "configure" })
            .input(noInput)
            .handle(async () => "configured"),
        },
      }),
      open: SimpleCLI.command({ description: "open" })
        .input(openInput)
        .handle(async ({ input }) => input),
    }, {
      globalNamed: {
        session: SimpleCLI.option(z.string().default("default")),
      },
    });

    await expect(app.run(["--session", "debug", "ai", "configure"])).resolves.toBe("configured");
    await expect(
      app.run(["--session", "debug", "open", "https://example.com"]),
    ).resolves.toEqual({
      url: "https://example.com",
      session: "debug",
    });
  });

  test("supports variadic positional arguments", async () => {
    const execInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("codeParts", z.array(z.string()).default([]), {
          variadic: true,
        }),
      ],
      named: {},
    }).refine((input) => input.codeParts.length > 0, "Usage: libretto exec <code>");

    const app = SimpleCLI.define("libretto", {
      exec: SimpleCLI.command({ description: "exec" })
        .input(execInput)
        .handle(async ({ input }) => input.codeParts.join(" ")),
    });

    await expect(
      app.run(["exec", "await", "page.goto('https://example.com')"]),
    ).resolves.toBe("await page.goto('https://example.com')");
  });

  test("throws a missing-value error when the next token is another flag", async () => {
    const input = SimpleCLI.input({
      positionals: [],
      named: {
        filter: SimpleCLI.option(z.string().optional()),
        clear: SimpleCLI.flag(),
      },
    });

    const app = SimpleCLI.define("libretto", {
      network: SimpleCLI.command({ description: "network" })
        .input(input)
        .handle(async ({ input }) => input),
    });

    await expect(
      app.run(["network", "--filter", "--clear"]),
    ).rejects.toThrow("Missing value for --filter.");
  });

  test("allows hyphen-prefixed option values when they are not recognized flags", async () => {
    const input = SimpleCLI.input({
      positionals: [],
      named: {
        session: SimpleCLI.option(z.string()),
      },
    });

    const app = SimpleCLI.define("libretto", {
      pages: SimpleCLI.command({ description: "pages" })
        .input(input)
        .handle(async ({ input }) => input),
    });

    await expect(
      app.run(["pages", "--session", "-dash"]),
    ).resolves.toEqual({
      session: "-dash",
    });
  });

  test("surfaces command-level input normalization errors from run", async () => {
    const openInput = SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("url", z.string().optional()),
      ],
      named: {
        headed: SimpleCLI.flag(),
        headless: SimpleCLI.flag(),
      },
    })
      .refine((input) => Boolean(input.url), "Usage: libretto-cli open <url>")
      .refine((input) => !(input.headed && input.headless), "Cannot pass both --headed and --headless.");

    const app = SimpleCLI.define("libretto-cli", {
      open: SimpleCLI.command({ description: "open" })
        .input(openInput)
        .handle(async () => {}),
    });

    await expect(app.run(["open"])).rejects.toThrow("Usage: libretto-cli open <url>");
    await expect(app.run(["open", "https://example.com", "--headed", "--headless"])).rejects.toThrow(
      "Cannot pass both --headed and --headless.",
    );
  });

  test("renders root and group help from route paths and descriptions", async () => {
    const noInput = SimpleCLI.input({ positionals: [], named: {} });
    const app = SimpleCLI.define("libretto-cli", {
      ai: SimpleCLI.group({
        description: "AI commands",
        routes: {
          configure: SimpleCLI.command({
            description: "Configure AI runtime",
          })
            .input(noInput)
            .handle(async () => {}),
        },
      }),
      open: SimpleCLI.command({ description: "Launch browser and open URL" })
        .input(noInput)
        .handle(async () => {}),
    });

    const rootHelp = await app.run(["help"]);
    expect(rootHelp).toBe(
      [
        "Usage: libretto-cli <command>",
        "",
        "Commands:",
        "  ai <subcommand>  AI commands",
        "  open  Launch browser and open URL",
      ].join("\n"),
    );

    const groupHelp = await app.run(["help", "ai"]);
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
      ai: SimpleCLI.group({
        description: "AI commands",
        routes: {
          configure: SimpleCLI.command({
            description: "Configure AI runtime",
          })
            .input(aiConfigureInput)
            .handle(async () => {}),
        },
      }),
    });

    const helpFromCommand = await app.run(["help", "ai", "configure"]);
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

    const helpFromFlag = await app.run(["ai", "configure", "--help"]);
    expect(helpFromFlag).toBe(helpFromCommand);
  });
});
