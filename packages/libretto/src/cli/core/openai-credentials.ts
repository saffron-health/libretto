import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type OpenAiCredentialSource =
  | "OPENAI_API_KEY"
  | "CODEX_OAUTH_TOKEN"
  | "codex-auth-json-api-key"
  | "codex-auth-json-oauth";

export type OpenAiCredentials =
  | {
      kind: "api-key";
      token: string;
      source: Extract<
        OpenAiCredentialSource,
        "OPENAI_API_KEY" | "codex-auth-json-api-key"
      >;
    }
  | {
      kind: "codex-oauth";
      token: string;
      accountId: string;
      source: Extract<
        OpenAiCredentialSource,
        "CODEX_OAUTH_TOKEN" | "codex-auth-json-oauth"
      >;
    };

type CodexAuthJson = {
  OPENAI_API_KEY?: unknown;
  tokens?: {
    access_token?: unknown;
    account_id?: unknown;
  };
};

const CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractAccountIdFromAccessToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    ) as {
      [CODEX_ACCOUNT_CLAIM]?: {
        chatgpt_account_id?: unknown;
      };
    };
    return readString(decoded[CODEX_ACCOUNT_CLAIM]?.chatgpt_account_id);
  } catch {
    return null;
  }
}

function readCodexAuthJson(env: NodeJS.ProcessEnv): CodexAuthJson | null {
  const codexHome = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const authPath = join(codexHome, "auth.json");
  if (!existsSync(authPath)) return null;

  try {
    return JSON.parse(readFileSync(authPath, "utf-8")) as CodexAuthJson;
  } catch {
    return null;
  }
}

export function resolveOpenAiCredentials(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiCredentials | null {
  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (openAiApiKey) {
    return { kind: "api-key", token: openAiApiKey, source: "OPENAI_API_KEY" };
  }

  const codexOAuthToken = env.CODEX_OAUTH_TOKEN?.trim();
  if (codexOAuthToken) {
    const accountId =
      env.CODEX_ACCOUNT_ID?.trim() ||
      env.CHATGPT_ACCOUNT_ID?.trim() ||
      extractAccountIdFromAccessToken(codexOAuthToken);
    if (accountId) {
      return {
        kind: "codex-oauth",
        token: codexOAuthToken,
        accountId,
        source: "CODEX_OAUTH_TOKEN",
      };
    }
  }

  const codexAuthJson = readCodexAuthJson(env);
  const codexAuthJsonApiKey = readString(codexAuthJson?.OPENAI_API_KEY);
  if (codexAuthJsonApiKey) {
    return {
      kind: "api-key",
      token: codexAuthJsonApiKey,
      source: "codex-auth-json-api-key",
    };
  }

  const codexAuthJsonOAuthToken = readString(
    codexAuthJson?.tokens?.access_token,
  );
  const codexAuthJsonAccountId = readString(codexAuthJson?.tokens?.account_id);
  if (codexAuthJsonOAuthToken) {
    const accountId =
      codexAuthJsonAccountId ||
      extractAccountIdFromAccessToken(codexAuthJsonOAuthToken);
    if (!accountId) return null;
    return {
      kind: "codex-oauth",
      token: codexAuthJsonOAuthToken,
      accountId,
      source: "codex-auth-json-oauth",
    };
  }

  return null;
}

export function hasOpenAiCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveOpenAiCredentials(env) !== null;
}
