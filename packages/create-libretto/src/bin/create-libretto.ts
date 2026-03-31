#!/usr/bin/env node

import { parseArgs, renderHelp, runBootstrap } from "../lib/bootstrap.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(renderHelp());
    return;
  }
  await runBootstrap(args);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  console.error("Help: create-libretto --help");
  process.exit(1);
});
