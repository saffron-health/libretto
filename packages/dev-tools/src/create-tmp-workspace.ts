#!/usr/bin/env node
/**
 * Creates a temporary workspace for testing the local libretto package.
 *
 * The workspace is a minimal git repo with:
 * - package.json pointing to the local libretto package
 * - libretto configured with google-vertex/gemini-2.5-flash for snapshots
 * - Playwright browsers installed
 *
 * Usage:
 *   pnpm create-tmp-workspace <name> [--dir <path>]
 */

import {
  createTmpWorkspace,
  type CreateTmpWorkspaceOptions,
} from "./tmp-workspace.js";

function printUsage(): void {
  console.log(`Usage: create-tmp-workspace <name> [--dir <path>]

Creates a temporary workspace for testing the local libretto package.

Arguments:
  name          Name for the workspace directory

Options:
  --dir <path>  Parent directory for the workspace (default: ./tmp)
  --help, -h    Show this help message`);
}

function parseArgs(argv: string[]): CreateTmpWorkspaceOptions | null {
  const args = argv.slice(2);
  let name: string | undefined;
  let parentDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--dir") {
      parentDir = args[++i];
      if (!parentDir) {
        console.error("Error: --dir requires a value");
        return null;
      }
    } else if (!arg.startsWith("-")) {
      name = arg;
    } else {
      console.error(`Error: unknown option ${arg}`);
      return null;
    }
  }

  if (!name) {
    console.error("Error: workspace name is required\n");
    printUsage();
    return null;
  }

  return { name, parentDir };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  if (!options) {
    process.exit(1);
  }

  try {
    const workspaceDir = await createTmpWorkspace(options);
    console.log(`\n✓ Workspace ready at: ${workspaceDir}`);
    console.log(`  cd ${workspaceDir}`);
    console.log(`  npx libretto open <url>`);
  } catch (error) {
    console.error(
      `\nFailed to create workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

main();
