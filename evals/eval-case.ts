import type { EvalContext } from "./fixtures.js";
import { normalizeAuthProfileDomain } from "./auth-profiles.js";

export type EvalCaseOptions = {
  name: string;
  authProfile?: string;
};

export type EvalCaseFn = (context: EvalContext) => Promise<void> | void;

export type EvalCaseRecord = {
  name: string;
  authProfile?: string;
  only: boolean;
  filePath: string | null;
  run: EvalCaseFn;
};

type RegisterEvalCaseOptions = {
  only?: boolean;
};

const registry: EvalCaseRecord[] = [];
let currentImportFilePath: string | null = null;

function registerEvalCase(
  options: EvalCaseOptions,
  run: EvalCaseFn,
  registerOptions: RegisterEvalCaseOptions = {},
): void {
  const name = options.name.trim();
  if (name.length === 0) {
    throw new Error("evalCase requires a non-empty name.");
  }

  let authProfile: string | undefined;
  if (options.authProfile !== undefined) {
    if (typeof options.authProfile !== "string") {
      throw new Error("evalCase authProfile must be a non-empty string.");
    }
    const trimmedAuthProfile = options.authProfile.trim();
    if (trimmedAuthProfile.length === 0) {
      throw new Error("evalCase authProfile must be a non-empty string.");
    }
    authProfile = normalizeAuthProfileDomain(trimmedAuthProfile);
  }

  registry.push({
    name,
    authProfile,
    only: registerOptions.only === true,
    filePath: currentImportFilePath,
    run,
  });
}

export const evalCase = Object.assign(
  (options: EvalCaseOptions, run: EvalCaseFn) => {
    registerEvalCase(options, run);
  },
  {
    only: (options: EvalCaseOptions, run: EvalCaseFn) => {
      registerEvalCase(options, run, { only: true });
    },
  },
);

export function getEvalCases(): EvalCaseRecord[] {
  return [...registry];
}

export async function withEvalFileRegistration<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = currentImportFilePath;
  currentImportFilePath = filePath;
  try {
    return await fn();
  } finally {
    currentImportFilePath = previous;
  }
}
