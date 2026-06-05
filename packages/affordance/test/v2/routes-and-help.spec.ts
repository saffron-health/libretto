import { describe, expect, test } from "vitest";
import outdent from "outdent";
import { Aff } from "../../src/v2/index.js";

describe("Aff v2 routes and direct invocation", () => {
  test("derives route keys and path tokens from route builders", () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({ description: "Configure AI runtime" })
          .handle(async () => {}),
      }),
      open: Aff.command({ description: "Open URL" })
        .handle(async () => {}),
    });

    expect(app.getCommands()).toEqual([
      {
        routeKey: "ai.configure",
        path: ["ai", "configure"],
        description: "Configure AI runtime",
      },
      {
        routeKey: "open",
        path: ["open"],
        description: "Open URL",
      },
    ]);
  });

  test("invokes no-input commands directly by route key", async () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({ description: "Configure AI runtime" })
          .handle(async ({ command }) => ({
            routeKey: command.routeKey,
            path: command.path,
          })),
      }),
      open: Aff.command({ description: "Open URL" })
        .handle(async ({ input, ctx, command }) => ({
          input,
          ctx,
          routeKey: command.routeKey,
        })),
    });

    await expect(app.invoke("ai.configure")).resolves.toEqual({
      routeKey: "ai.configure",
      path: ["ai", "configure"],
    });
    await expect(
      app.invoke("open", { debug: true }, { session: "test" }),
    ).resolves.toEqual({
      input: { debug: true },
      ctx: { session: "test" },
      routeKey: "open",
    });
  });

  test("throws a clear error for unknown route keys", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" })
        .handle(async () => "opened"),
    });

    await expect(app.invoke("missing")).rejects.toThrow(
      "Unknown command route: missing",
    );
  });

  test("executes no-input commands by command-line path", async () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({ description: "Configure AI runtime" })
          .handle(async ({ command, input, ctx }) => ({
            routeKey: command.routeKey,
            input,
            ctx,
          })),
      }),
      open: Aff.command({ description: "Open URL" })
        .handle(async () => "opened"),
    });

    await expect(app.exec("ai configure")).resolves.toEqual({
      routeKey: "ai.configure",
      input: {},
      ctx: {},
    });
    await expect(app.exec("open")).resolves.toBe("opened");
  });

  test("renders root, group, and command help", async () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({ description: "Configure AI runtime" })
          .handle(async () => {}),
      }),
      open: Aff.command({ description: "Open URL" })
        .handle(async () => {}),
    });

    await expect(app.exec("help")).resolves.toBe(
      outdent`
        Usage: libretto <command>

        Commands:
          ai <subcommand>  AI commands
          open  Open URL
      `,
    );
    await expect(app.exec("help ai")).resolves.toBe(
      outdent`
        AI commands

        Usage: libretto ai <subcommand>

        Commands:
          configure  Configure AI runtime
      `,
    );
    await expect(app.exec("ai help")).resolves.toBe(
      outdent`
        AI commands

        Usage: libretto ai <subcommand>

        Commands:
          configure  Configure AI runtime
      `,
    );
    await expect(app.exec("ai")).resolves.toBe(
      outdent`
        AI commands

        Usage: libretto ai <subcommand>

        Commands:
          configure  Configure AI runtime
      `,
    );
    await expect(app.exec("help ai configure")).resolves.toBe(
      outdent`
        Configure AI runtime

        Usage: libretto ai configure
      `,
    );
    await expect(app.exec("ai configure help")).resolves.toBe(
      outdent`
        Configure AI runtime

        Usage: libretto ai configure
      `,
    );
  });
});
