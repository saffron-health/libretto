import { relative, win32 } from "node:path";
import { z } from "zod";
import { generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { Page } from "playwright";

export type SupportedAgentProvider = "anthropic" | "openai";

export type LibrettoDebuggerMode = "open_pr";

export type GitHubDebuggerConfig = {
  owner: string;
  repo: string;
  baseBranch: string;
  token?: string;
  librettoApiKey?: string;
  librettoApiUrl?: string;
  apiBaseUrl?: string;
  repositoryRoot?: string;
};

export type AgentModelConfig = {
  model: string;
  apiKey?: string;
  maxSourceFileBytes?: number;
};

export type SourceFile = {
  path: string;
  content: string;
};

export type FailureContext = {
  message: string;
  stack?: string;
  url?: string;
  title?: string;
  domSnapshot?: string;
  screenshot?: {
    mimeType: "image/png";
    base64: string;
  };
};

export type AgentFileChange = {
  path: string;
  content: string;
};

export type AgentFix = {
  summary: string;
  rationale: string;
  changes: AgentFileChange[];
};

export type DebugAgentContext = {
  model: {
    provider: SupportedAgentProvider;
    modelId: string;
  };
  failure: FailureContext;
  sourceFiles: SourceFile[];
};

export type DebugAgentRunner = (
  context: DebugAgentContext,
) => Promise<AgentFix>;

export type LibrettoDebuggerOptions = {
  github: GitHubDebuggerConfig;
  agent: AgentModelConfig;
  mode?: LibrettoDebuggerMode;
  modelRunner?: DebugAgentRunner;
  fetch?: typeof fetch;
  now?: () => Date;
};

export type CreateGitHubConnectUrlOptions = {
  owner: string;
  repo: string;
  librettoApiKey?: string;
  librettoApiUrl?: string;
  fetch?: typeof fetch;
};

export type DebugPlaywrightFailureOptions = {
  branchName?: string;
  includeFiles?: string[];
};

export type DebugPlaywrightFailureResult =
  | {
      status: "no_changes";
      summary: string;
      rationale: string;
      sourceFiles: SourceFile[];
    }
  | {
      status: "pull_request_opened";
      summary: string;
      rationale: string;
      branchName: string;
      pullRequestUrl: string;
      changedFiles: string[];
      sourceFiles: SourceFile[];
    };

export type LibrettoDebugger = {
  debugPlaywrightFailure: (
    error: unknown,
    page: Page,
    options?: DebugPlaywrightFailureOptions,
  ) => Promise<DebugPlaywrightFailureResult>;
};

type GitRefResponse = {
  object: {
    sha: string;
  };
};

type GitCommitResponse = {
  sha: string;
  tree: {
    sha: string;
  };
};

type GitBlobResponse = {
  sha: string;
};

type GitTreeResponse = {
  sha: string;
};

type GitPullResponse = {
  html_url: string;
};

type GitHubContentResponse = {
  type: string;
  encoding?: string;
  content?: string;
};

type BrokeredInstallationTokenResponse = {
  token: string;
  expires_at: string;
};

const DEFAULT_MAX_SOURCE_FILE_BYTES = 80_000;
const DEFAULT_MAX_DOM_CHARS = 120_000;
const DEFAULT_LIBRETTO_API_URL = "https://api.libretto.sh";

const agentFixSchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  changes: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
  ),
});

export function createLibrettoDebugger(
  options: LibrettoDebuggerOptions,
): LibrettoDebugger {
  const mode = options.mode ?? "open_pr";
  if (mode !== "open_pr") {
    throw new Error(`Unsupported debugger mode "${mode}". Supported mode: open_pr.`);
  }

  const model = parseAgentModel(options.agent.model);
  const maxSourceFileBytes =
    options.agent.maxSourceFileBytes ?? DEFAULT_MAX_SOURCE_FILE_BYTES;
  const now = options.now ?? (() => new Date());

  return {
    async debugPlaywrightFailure(error, page, failureOptions = {}) {
      const failure = await captureFailureContext(error, page);
      const github = await GitHubClient.create({
        config: options.github,
        fetchImpl: options.fetch ?? globalThis.fetch,
      });

      const base = await github.getBase(options.github.baseBranch);
      const requestedFiles = collectCandidateFiles({
        stack: failure.stack,
        repositoryRoot: options.github.repositoryRoot ?? process.cwd(),
        includeFiles: failureOptions.includeFiles,
      });
      const sourceFiles = await github.readSourceFiles({
        paths: requestedFiles,
        ref: options.github.baseBranch,
        maxBytes: maxSourceFileBytes,
      });

      const runner =
        options.modelRunner ??
        ((context: DebugAgentContext) =>
          runDefaultDebugAgent(context, options.agent.apiKey));
      const fix = agentFixSchema.parse(
        await runner({
          model,
          failure,
          sourceFiles,
        }),
      );
      const changes = normalizeChanges(fix.changes);
      if (changes.length === 0) {
        return {
          status: "no_changes",
          summary: fix.summary,
          rationale: fix.rationale,
          sourceFiles,
        };
      }

      const branchName =
        failureOptions.branchName ??
        createBranchName({
          owner: options.github.owner,
          repo: options.github.repo,
          date: now(),
        });
      await github.createBranch(branchName, base.commitSha);
      const commitSha = await github.commitFileChanges({
        branchName,
        baseCommitSha: base.commitSha,
        baseTreeSha: base.treeSha,
        changes,
        message: "Apply Libretto autofix for Playwright failure",
      });
      await github.updateBranch(branchName, commitSha);
      const pullRequestUrl = await github.openPullRequest({
        branchName,
        baseBranch: options.github.baseBranch,
        title: "Libretto autofix for Playwright failure",
        body: createPullRequestBody({
          fix,
          failure,
          sourceFiles,
          changedFiles: changes.map((change) => change.path),
        }),
      });

      return {
        status: "pull_request_opened",
        summary: fix.summary,
        rationale: fix.rationale,
        branchName,
        pullRequestUrl,
        changedFiles: changes.map((change) => change.path),
        sourceFiles,
      };
    },
  };
}

export async function createLibrettoGitHubConnectUrl(
  options: CreateGitHubConnectUrlOptions,
): Promise<string> {
  const apiKey =
    options.librettoApiKey?.trim() ?? process.env.LIBRETTO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Creating a GitHub connect URL requires LIBRETTO_API_KEY or librettoApiKey.",
    );
  }

  const apiUrl = trimTrailingSlash(
    options.librettoApiUrl?.trim() ??
      process.env.LIBRETTO_API_URL?.trim() ??
      DEFAULT_LIBRETTO_API_URL,
  );
  const response = await (options.fetch ?? globalThis.fetch)(
    `${apiUrl}/v1/github/createConnectUrl`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        json: {
          owner: options.owner,
          repo: options.repo,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Libretto GitHub connect URL request failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { json?: { url?: string } };
  if (!body.json?.url) {
    throw new Error("Libretto GitHub connect URL response did not include a URL.");
  }
  return body.json.url;
}

export function parseAgentModel(model: string): {
  provider: SupportedAgentProvider;
  modelId: string;
} {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid agent model "${model}". Expected "provider/model-id", for example "openai/gpt-5.4".`,
    );
  }
  const provider = model.slice(0, slashIndex).toLowerCase();
  const modelId = model.slice(slashIndex + 1).trim();
  if (!modelId) {
    throw new Error(`Invalid agent model "${model}". Model id cannot be empty.`);
  }
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error(
      `Unsupported agent model provider "${provider}". Supported providers: openai, anthropic.`,
    );
  }
  return { provider, modelId };
}

async function captureFailureContext(
  error: unknown,
  page: Page,
): Promise<FailureContext> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown Playwright failure";
  const stack = error instanceof Error ? error.stack : undefined;
  const [url, title, screenshot, domSnapshot] = await Promise.all([
    tryRead(() => Promise.resolve(page.url())),
    tryRead(() => page.title()),
    tryRead(async () => {
      const buffer = await page.screenshot({
        fullPage: true,
        type: "png",
        timeout: 10_000,
      });
      return {
        mimeType: "image/png" as const,
        base64: Buffer.from(buffer).toString("base64"),
      };
    }),
    tryRead(async () => truncate(await page.content(), DEFAULT_MAX_DOM_CHARS)),
  ]);

  return {
    message,
    stack,
    url: url ?? undefined,
    title: title ?? undefined,
    screenshot: screenshot ?? undefined,
    domSnapshot: domSnapshot ?? undefined,
  };
}

async function tryRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function collectCandidateFiles(args: {
  stack?: string;
  repositoryRoot: string;
  includeFiles?: string[];
}): string[] {
  const files = new Set<string>();
  for (const file of args.includeFiles ?? []) {
    files.add(normalizeRepoPath(file));
  }

  if (args.stack) {
    for (const rawPath of collectStackFilePaths(args.stack)) {
      const repoPath = relativeToRepositoryRoot(rawPath, args.repositoryRoot);
      if (!repoPath.startsWith("..")) {
        files.add(normalizeRepoPath(repoPath));
      }
    }
  }

  return [...files].filter(isSafeRepoPath);
}

function relativeToRepositoryRoot(path: string, repositoryRoot: string): string {
  if (isWindowsAbsolutePath(path) || isWindowsAbsolutePath(repositoryRoot)) {
    return win32.relative(repositoryRoot, path);
  }
  return path.startsWith("/") ? relative(repositoryRoot, path) : path;
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function collectStackFilePaths(stack: string): string[] {
  const paths = new Set<string>();
  for (const line of stack.split("\n")) {
    for (const token of splitStackLine(line)) {
      const path = parseStackLocation(token);
      if (path) {
        paths.add(path);
      }
    }
  }
  return [...paths];
}

function splitStackLine(line: string): string[] {
  const tokens: string[] = [];
  let token = "";
  for (const char of line) {
    if (char === " " || char === "\t" || char === "(" || char === ")") {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += char;
    }
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function parseStackLocation(token: string): string | null {
  const normalized = trimStackTokenPrefixAndSuffix(token);
  const columnColonIndex = normalized.lastIndexOf(":");
  if (columnColonIndex === -1) return null;

  const lineColonIndex = normalized.lastIndexOf(":", columnColonIndex - 1);
  if (lineColonIndex === -1) return null;

  const line = normalized.slice(lineColonIndex + 1, columnColonIndex);
  const column = normalized.slice(columnColonIndex + 1);
  if (!isDigits(line) || !isDigits(column)) return null;

  const path = normalized.slice(0, lineColonIndex);
  if (!hasSupportedSourceExtension(path)) return null;

  return path;
}

function trimStackTokenPrefixAndSuffix(token: string): string {
  let value = token.startsWith("file://") ? token.slice("file://".length) : token;
  while (value.endsWith(",") || value.endsWith(";")) {
    value = value.slice(0, -1);
  }
  return value;
}

function isDigits(value: string): boolean {
  if (!value) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

function hasSupportedSourceExtension(path: string): boolean {
  return [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].some(
    (extension) => path.endsWith(extension),
  );
}

function normalizeChanges(changes: AgentFileChange[]): AgentFileChange[] {
  const byPath = new Map<string, AgentFileChange>();
  for (const change of changes) {
    const path = normalizeRepoPath(change.path);
    if (!isSafeRepoPath(path)) {
      throw new Error(`Unsafe repository path returned by debug agent: ${change.path}`);
    }
    byPath.set(path, { path, content: change.content });
  }
  return [...byPath.values()];
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isSafeRepoPath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.startsWith("../") &&
    !path.includes("/../") &&
    path !== ".."
  );
}

function createBranchName(args: {
  owner: string;
  repo: string;
  date: Date;
}): string {
  const iso = args.date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return `libretto-debug/${slugify(args.owner)}-${slugify(args.repo)}-${iso}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function createPullRequestBody(args: {
  fix: AgentFix;
  failure: FailureContext;
  sourceFiles: SourceFile[];
  changedFiles: string[];
}): string {
  const lines = [
    "## Libretto autofix",
    "",
    args.fix.summary,
    "",
    "## Why",
    "",
    args.fix.rationale,
    "",
    "## Failure context",
    "",
    `- Error: ${args.failure.message}`,
    args.failure.url ? `- URL: ${args.failure.url}` : null,
    args.failure.title ? `- Page title: ${args.failure.title}` : null,
    args.failure.screenshot ? "- Screenshot: captured from the failed page" : null,
    args.failure.domSnapshot ? "- DOM snapshot: captured from the failed page" : null,
    "",
    "## Files",
    "",
    ...args.changedFiles.map((path) => `- Changed: \`${path}\``),
    ...args.sourceFiles
      .filter((file) => !args.changedFiles.includes(file.path))
      .map((file) => `- Inspected: \`${file.path}\``),
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

async function runDefaultDebugAgent(
  context: DebugAgentContext,
  apiKeyOverride?: string,
): Promise<AgentFix> {
  const model = await resolveLanguageModel(context.model, apiKeyOverride);
  const result = await generateObject({
    model,
    schema: agentFixSchema,
    prompt: createAgentPrompt(context),
  });
  return result.object;
}

async function resolveLanguageModel(
  model: DebugAgentContext["model"],
  apiKeyOverride?: string,
): Promise<LanguageModel> {
  if (model.provider === "openai") {
    const apiKey = apiKeyOverride ?? process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OpenAI API key is missing. Set OPENAI_API_KEY or agent.apiKey.");
    }
    return createOpenAI({ apiKey })(model.modelId);
  }

  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is missing. Set ANTHROPIC_API_KEY or agent.apiKey.",
    );
  }
  return createAnthropic({ apiKey })(model.modelId);
}

function createAgentPrompt(context: DebugAgentContext): string {
  const files = context.sourceFiles
    .map(
      (file) =>
        `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``,
    )
    .join("\n\n");
  return [
    "You are fixing a failed Playwright browser automation.",
    "Return full-file replacements only for files that must change.",
    "Do not edit unrelated code. If there is not enough evidence, return an empty changes array.",
    "",
    "Failure:",
    `Message: ${context.failure.message}`,
    context.failure.stack ? `Stack:\n${context.failure.stack}` : null,
    context.failure.url ? `URL: ${context.failure.url}` : null,
    context.failure.title ? `Title: ${context.failure.title}` : null,
    context.failure.domSnapshot
      ? `DOM snapshot:\n${truncate(context.failure.domSnapshot, DEFAULT_MAX_DOM_CHARS)}`
      : null,
    "",
    "Source files:",
    files || "No stack-linked source files were found.",
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

class GitHubClient {
  private constructor(
    private readonly args: {
      owner: string;
      repo: string;
      token: string;
      apiBaseUrl: string;
      fetchImpl: typeof fetch;
    },
  ) {}

  static async create(args: {
    config: GitHubDebuggerConfig;
    fetchImpl: typeof fetch;
  }): Promise<GitHubClient> {
    const apiBaseUrl = trimTrailingSlash(
      args.config.apiBaseUrl ?? "https://api.github.com",
    );
    const token =
      args.config.token?.trim() ??
      process.env.LIBRETTO_GITHUB_TOKEN?.trim() ??
      process.env.GITHUB_TOKEN?.trim() ??
      (await createBrokeredInstallationToken({
        config: args.config,
        fetchImpl: args.fetchImpl,
      }));
    if (!token) {
      throw new Error(
        "GitHub authentication is missing. Provide github.token, LIBRETTO_GITHUB_TOKEN, GITHUB_TOKEN, or LIBRETTO_API_KEY for a repository linked to Libretto Cloud.",
      );
    }
    return new GitHubClient({
      owner: args.config.owner,
      repo: args.config.repo,
      token,
      apiBaseUrl,
      fetchImpl: args.fetchImpl,
    });
  }

  async getBase(baseBranch: string): Promise<{
    commitSha: string;
    treeSha: string;
  }> {
    const ref = await this.request<GitRefResponse>(
      "GET",
      `/repos/${this.pathPrefix()}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    );
    const commit = await this.request<GitCommitResponse>(
      "GET",
      `/repos/${this.pathPrefix()}/git/commits/${ref.object.sha}`,
    );
    return { commitSha: commit.sha, treeSha: commit.tree.sha };
  }

  async createBranch(branchName: string, sha: string): Promise<void> {
    await this.request("POST", `/repos/${this.pathPrefix()}/git/refs`, {
      body: {
        ref: `refs/heads/${branchName}`,
        sha,
      },
    });
  }

  async readSourceFiles(args: {
    paths: string[];
    ref: string;
    maxBytes: number;
  }): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    for (const path of args.paths) {
      const content = await this.tryReadFile(path, args.ref);
      if (content === null) continue;
      files.push({
        path,
        content: truncateByBytes(content, args.maxBytes),
      });
    }
    return files;
  }

  async commitFileChanges(args: {
    branchName: string;
    baseCommitSha: string;
    baseTreeSha: string;
    changes: AgentFileChange[];
    message: string;
  }): Promise<string> {
    const treeEntries = [];
    for (const change of args.changes) {
      const blob = await this.request<GitBlobResponse>(
        "POST",
        `/repos/${this.pathPrefix()}/git/blobs`,
        {
          body: {
            content: change.content,
            encoding: "utf-8",
          },
        },
      );
      treeEntries.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const tree = await this.request<GitTreeResponse>(
      "POST",
      `/repos/${this.pathPrefix()}/git/trees`,
      {
        body: {
          base_tree: args.baseTreeSha,
          tree: treeEntries,
        },
      },
    );
    const commit = await this.request<GitCommitResponse>(
      "POST",
      `/repos/${this.pathPrefix()}/git/commits`,
      {
        body: {
          message: args.message,
          tree: tree.sha,
          parents: [args.baseCommitSha],
        },
      },
    );
    return commit.sha;
  }

  async updateBranch(branchName: string, sha: string): Promise<void> {
    await this.request(
      "PATCH",
      `/repos/${this.pathPrefix()}/git/refs/heads/${encodeURIComponent(branchName)}`,
      {
        body: { sha },
      },
    );
  }

  async openPullRequest(args: {
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<string> {
    const response = await this.request<GitPullResponse>(
      "POST",
      `/repos/${this.pathPrefix()}/pulls`,
      {
        body: {
          title: args.title,
          head: args.branchName,
          base: args.baseBranch,
          body: args.body,
        },
      },
    );
    return response.html_url;
  }

  private async tryReadFile(path: string, ref: string): Promise<string | null> {
    try {
      const response = await this.request<GitHubContentResponse>(
        "GET",
        `/repos/${this.pathPrefix()}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      );
      if (response.type !== "file" || response.encoding !== "base64") return null;
      return Buffer.from(response.content ?? "", "base64").toString("utf8");
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown } = {},
  ): Promise<T> {
    const response = await this.args.fetchImpl(`${this.args.apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.args.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      throw new GitHubRequestError(
        response.status,
        `GitHub ${method} ${path} failed: ${await response.text()}`,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private pathPrefix(): string {
    return `${encodeURIComponent(this.args.owner)}/${encodeURIComponent(this.args.repo)}`;
  }
}

class GitHubRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function createBrokeredInstallationToken(args: {
  config: GitHubDebuggerConfig;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  const apiKey =
    args.config.librettoApiKey?.trim() ?? process.env.LIBRETTO_API_KEY?.trim();
  if (!apiKey) return null;

  const apiUrl = trimTrailingSlash(
    args.config.librettoApiUrl?.trim() ??
      process.env.LIBRETTO_API_URL?.trim() ??
      DEFAULT_LIBRETTO_API_URL,
  );
  const response = await args.fetchImpl(
    `${apiUrl}/v1/github/createInstallationToken`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        json: {
          owner: args.config.owner,
          repo: args.config.repo,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Libretto GitHub installation token request failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    json?: BrokeredInstallationTokenResponse;
  };
  if (!body.json?.token) {
    throw new Error(
      "Libretto GitHub installation token response did not include a token.",
    );
  }
  return body.json.token;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function truncateByBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated ${buffer.byteLength - maxBytes} bytes]`;
}
