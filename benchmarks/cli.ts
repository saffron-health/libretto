import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { SimpleCLI } from "./libretto-internals.js";
import { webVoyagerCommands } from "./webVoyager/commands.js";

type BenchmarksCLIResult =
  | void
  | string
  | {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    };

function isRootHelpRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length === 0) return true;
  if (rawArgs[0] === "--help" || rawArgs[0] === "-h") return true;
  return rawArgs[0] === "help" && rawArgs.length === 1;
}

function renderUsage(app: ReturnType<typeof createBenchmarksCLIApp>): string {
  return `${app.renderHelp()}

Examples:
  pnpm benchmarks webVoyager run --offset 100 --count 10
  pnpm benchmarks webVoyager run --count 10 --random --seed 20260327
  pnpm benchmarks help webVoyager run
`;
}

export function createBenchmarksCLIApp() {
  return SimpleCLI.define("benchmarks", {
    webVoyager: webVoyagerCommands,
  });
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const app = createBenchmarksCLIApp();
  let exitCode = 0;

  try {
    if (isRootHelpRequest(argv)) {
      console.log(renderUsage(app));
      return 0;
    }

    const result = (await app.run(argv)) as BenchmarksCLIResult;
    if (typeof result === "string") {
      console.log(result);
      return 0;
    }

    if (result && typeof result === "object") {
      if (typeof result.stdout === "string" && result.stdout.length > 0) {
        console.log(result.stdout);
      }
      if (typeof result.stderr === "string" && result.stderr.length > 0) {
        console.error(result.stderr);
      }
      if (typeof result.exitCode === "number") {
        exitCode = result.exitCode;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Unknown command: ")) {
      console.error(`${message}\n`);
      console.log(renderUsage(app));
    } else {
      console.error(message);
    }
    exitCode = 1;
  }

  return exitCode;
}

function isExecutedAsScript(): boolean {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isExecutedAsScript()) {
  const exitCode = await main();
  process.exit(exitCode);
}
