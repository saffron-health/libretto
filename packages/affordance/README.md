# affordance

A small TypeScript framework for building agent-friendly CLIs with typed command inputs, nested route groups, middleware, and generated help.

Affordance is intentionally opinionated: CLIs should be easy for agents to
recover from. Unknown commands include the most relevant help text by default.
For example, `mycli cloud deplot` reports the unknown command and shows
`mycli cloud <subcommand>` help instead of sending the agent back to root help.

## Install

```sh
pnpm add affordance zod
```

## Example

```ts
import { SimpleCLI } from "affordance";
import { z } from "zod";

const app = SimpleCLI.define("mycli", {
  open: SimpleCLI.command({ description: "Open a URL" })
    .input(
      SimpleCLI.input({
        positionals: [
          SimpleCLI.positional("url", z.string(), { help: "URL to open" }),
        ],
        named: {
          headless: SimpleCLI.flag({ help: "Run without a visible browser" }),
        },
      }),
    )
    .handle(async ({ input }) => {
      console.log(`Opening ${input.url}`);
    }),
});

await app.run(process.argv.slice(2));
```

## Root Help

Affordance renders root help from the command tree, including one-line command
descriptions. CLIs can append root-only help text for global options or
agent-facing guidance:

```ts
const app = SimpleCLI.define("mycli", routes, {
  appendHelpText: [
    "Options:",
    "  --profile <name>  Use a saved profile",
    "  -h, --help",
  ].join("\n"),
});
```

The appended text is included in `mycli help`, `mycli --help`, `mycli -h`, and
unknown root-command recovery output.

## Unknown Commands

When command resolution fails, Affordance includes scoped help in the thrown
error message:

- Unknown root commands show root help.
- Unknown commands below a group show the nearest group help.
- Unknown commands below nested groups show the deepest matching group help.

For a route tree with `cloud deploy` and `cloud auth login`, a typo like
`mycli cloud auth logni` produces:

```text
Unknown command: cloud auth logni

Auth commands

Usage: mycli cloud auth <subcommand>

Commands:
  login  Log in
```
