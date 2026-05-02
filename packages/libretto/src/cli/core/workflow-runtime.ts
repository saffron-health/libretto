import type { BrowserContext } from "playwright";
import { existsSync } from "node:fs";
import { cwd } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { instrumentContext } from "../../index.js";
import {
  getDefaultWorkflowFromModuleExports,
  getWorkflowsFromModuleExports,
  type ExportedLibrettoWorkflow,
  type LibrettoWorkflowContext,
} from "../../shared/workflow/workflow.js";
import type { LoggerApi } from "../../shared/logger/index.js";

type LoadedLibrettoWorkflow = ExportedLibrettoWorkflow & {
  run: (ctx: LibrettoWorkflowContext, input: unknown) => Promise<unknown>;
};

const TSCONFIG_HINT =
  "TypeScript compilation failed. Pass --tsconfig <path> to run against a specific tsconfig.";

function isTsxCompileError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "TransformError" ||
      error.message.startsWith("Cannot resolve tsconfig at path:"))
  );
}

export function getAbsoluteIntegrationPath(integrationPath: string): string {
  const absolutePath = isAbsolute(integrationPath)
    ? integrationPath
    : resolve(cwd(), integrationPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Integration file does not exist: ${absolutePath}`);
  }
  return absolutePath;
}

export async function loadDefaultWorkflow(
  absolutePath: string,
): Promise<LoadedLibrettoWorkflow> {
  let loadedModule: Record<string, unknown>;
  try {
    loadedModule = (await import(pathToFileURL(absolutePath).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const compileHint = isTsxCompileError(error) ? `\n${TSCONFIG_HINT}` : "";
    throw new Error(
      `Failed to import integration module at ${absolutePath}: ${message}${compileHint}`,
    );
  }

  const defaultWorkflow = getDefaultWorkflowFromModuleExports(loadedModule);
  if (defaultWorkflow) {
    return defaultWorkflow as LoadedLibrettoWorkflow;
  }

  const availableWorkflowNames = getWorkflowsFromModuleExports(loadedModule).map(
    (candidate) => candidate.name,
  );

  if (availableWorkflowNames.length === 0) {
    throw new Error(
      `No default-exported workflow found in ${absolutePath}. Export the workflow with \`export default workflow("name", handler)\`.`,
    );
  }

  throw new Error(
    `No default-exported workflow found in ${absolutePath}. libretto run only uses the file's default export. Available named workflows: ${availableWorkflowNames.join(", ")}`,
  );
}

export async function installHeadedWorkflowVisualization(args: {
  context: BrowserContext;
  logger: LoggerApi;
  instrument?: typeof instrumentContext;
}): Promise<void> {
  await (args.instrument ?? instrumentContext)(args.context, {
    visualize: true,
    logger: args.logger,
  });
}
