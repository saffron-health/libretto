import { AsyncLocalStorage } from "node:async_hooks";

/** Auth used by workflow helpers to call Libretto Cloud APIs. */
export type LibrettoJobAuth = {
  apiUrl: string;
  token?: string;
  apiKey?: string;
};

/** Injected by Libretto Cloud into hosted job params. Not part of user input. */
export const LIBRETTO_RUNTIME_PARAM_KEY = "__libretto" as const;

/** Header for presenting a hosted job token to the API. */
export const LIBRETTO_JOB_TOKEN_HEADER = "x-libretto-job-token" as const;

type LibrettoRuntimeStore = {
  job?: LibrettoJobAuth;
};

const runtimeStore = new AsyncLocalStorage<LibrettoRuntimeStore>();

function readJobAuthFromBlob(value: unknown): LibrettoJobAuth | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const job = (value as { job?: unknown }).job;
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return undefined;
  }
  const record = job as Record<string, unknown>;
  const apiUrl = typeof record.apiUrl === "string" ? record.apiUrl.trim() : "";
  const token = typeof record.token === "string" ? record.token.trim() : "";
  if (!apiUrl || !token) return undefined;
  return { apiUrl, token };
}

/**
 * Pull Libretto-injected runtime auth out of raw workflow params so it never
 * reaches the user's Zod schema or handler input.
 */
export function takeLibrettoRuntimeFromInput(input: unknown): {
  input: unknown;
  store: LibrettoRuntimeStore;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { input, store: {} };
  }
  const record = { ...(input as Record<string, unknown>) };
  const blob = record[LIBRETTO_RUNTIME_PARAM_KEY];
  delete record[LIBRETTO_RUNTIME_PARAM_KEY];
  return {
    input: record,
    store: { job: readJobAuthFromBlob(blob) },
  };
}

export function runWithLibrettoRuntimeAuth<T>(
  store: LibrettoRuntimeStore,
  fn: () => T,
): T {
  return runtimeStore.run(store, fn);
}

export function getLibrettoRuntimeJobAuth(): LibrettoJobAuth | undefined {
  return runtimeStore.getStore()?.job;
}
