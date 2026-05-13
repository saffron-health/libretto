# affordance

A small TypeScript framework for building agent-friendly CLIs with typed command inputs, nested route groups, middleware, and generated help.

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
