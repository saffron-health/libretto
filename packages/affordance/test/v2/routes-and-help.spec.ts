import { describe, expect, test } from "vitest";
import outdent from "outdent";
import { Aff } from "../../src/v2/index.js";

describe("Aff v2 routes and direct invocation", () => {
  test("derives route keys and path tokens from route builders", () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({
          description: "Configure AI runtime",
        }).handle(),
      }),
      open: Aff.command({ description: "Open URL" }).handle(),
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
        configure: Aff.command({ description: "Configure AI runtime" }).handle(
          async ({ command }) => ({
            routeKey: command.routeKey,
            path: command.path,
          }),
        ),
      }),
      open: Aff.command({ description: "Open URL" }).handle(async ({ input, ctx, command }) => ({
        input,
        ctx,
        routeKey: command.routeKey,
      })),
    });

    await expect(app.invoke("ai.configure")).resolves.toEqual({
      routeKey: "ai.configure",
      path: ["ai", "configure"],
    });
    await expect(app.invoke("open", [], {}, { session: "test" })).resolves.toEqual({
      input: {},
      ctx: { session: "test" },
      routeKey: "open",
    });
  });

  test("throws a clear error for unknown route keys", async () => {
    const app = Aff.cli("libretto").routes({
      open: Aff.command({ description: "Open URL" }).handle(async () => "opened"),
    });

    await expect(app.invoke("missing")).rejects.toThrow("Unknown command route: missing");
  });

  test("executes no-input commands by command-line path", async () => {
    const app = Aff.cli("libretto").routes({
      ai: Aff.group({ description: "AI commands" }).routes({
        configure: Aff.command({ description: "Configure AI runtime" }).handle(
          async ({ command, input, ctx }) => ({
            routeKey: command.routeKey,
            input,
            ctx,
          }),
        ),
      }),
      open: Aff.command({ description: "Open URL" }).handle(async () => "opened"),
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
        configure: Aff.command({
          description: "Configure AI runtime",
        }).handle(),
      }),
      open: Aff.command({ description: "Open URL" }).handle(),
    });

    await expect(app.exec("help")).resolves.toBe(
      outdent`
        Usage: libretto <command>

        Commands:
          ai <subcommand>  AI commands
          open  Open URL
      `,
    );
    await expect(app.exec("--help")).resolves.toBe(
      outdent`
        Usage: libretto <command>

        Commands:
          ai <subcommand>  AI commands
          open  Open URL
      `,
    );
    await expect(app.exec("-h")).resolves.toBe(
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
    await expect(app.exec("ai --help")).resolves.toBe(
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
    await expect(app.exec("ai configure --help")).resolves.toBe(
      outdent`
        Configure AI runtime

        Usage: libretto ai configure
      `,
    );
  });

  test("includes nearest help for unknown commands", async () => {
    const app = Aff.cli("libretto").routes({
      cloud: Aff.group({ description: "Libretto Cloud commands" }).routes({
        deploy: Aff.command({
          description: "Deploy workflows to the hosted platform",
        }).handle(),
        auth: Aff.group({
          description: "Hosted-platform auth commands",
        }).routes({
          login: Aff.command({
            description: "Log in to the hosted platform",
          }).handle(),
        }),
      }),
      open: Aff.command({
        description: "Launch browser and open URL",
      }).handle(),
    });

    await expect(app.exec("opne")).rejects.toThrow(
      outdent`
        Unknown command: opne

        Usage: libretto <command>

        Commands:
          cloud <subcommand>  Libretto Cloud commands
          open  Launch browser and open URL
      `,
    );

    await expect(app.exec("cloud opne")).rejects.toThrow(
      outdent`
        Unknown command: cloud opne

        Libretto Cloud commands

        Usage: libretto cloud <subcommand>

        Commands:
          deploy  Deploy workflows to the hosted platform
          auth <subcommand>  Hosted-platform auth commands
      `,
    );

    await expect(app.exec("cloud auth logni")).rejects.toThrow(
      outdent`
        Unknown command: cloud auth logni

        Hosted-platform auth commands

        Usage: libretto cloud auth <subcommand>

        Commands:
          login  Log in to the hosted platform
      `,
    );
  });
});
