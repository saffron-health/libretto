import { describe, expect, test } from "vitest";
import outdent from "outdent";
import { Aff } from "../../src/v2/index.js";

describe("Aff v2 routes and help", () => {
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
    await expect(app.exec("help ai configure")).resolves.toBe(
      outdent`
        Configure AI runtime

        Usage: libretto ai configure
      `,
    );
  });

  test("includes nearest help for unknown commands", async () => {
    const app = Aff.cli("libretto").routes({
      cloud: Aff.group({ description: "Cloud commands" }).routes({
        auth: Aff.group({ description: "Auth commands" }).routes({
          login: Aff.command({ description: "Log in" })
              .handle(async () => {}),
        }),
      }),
    });

    await expect(app.exec("cluod")).rejects.toThrow(
      outdent`
        Unknown command: cluod

        Usage: libretto <command>

        Commands:
          cloud <subcommand>  Cloud commands
      `,
    );
    await expect(app.exec("cloud auth logni")).rejects.toThrow(
      outdent`
        Unknown command: cloud auth logni

        Auth commands

        Usage: libretto cloud auth <subcommand>

        Commands:
          login  Log in
      `,
    );
  });
});
