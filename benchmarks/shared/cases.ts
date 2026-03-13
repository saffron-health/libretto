import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { expect } from "vitest";
import { writeAiConfig } from "../../src/cli/core/ai-config.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  EvalResponse,
  type ClaudeEvalHarness,
} from "../../evals/harness.js";
import type { ModelUsage, NonNullableUsage } from "@anthropic-ai/claude-agent-sdk";
import {
  createClaudeBenchmarkHarness,
  getBenchmarkAnalyzerPath,
  getBenchmarkDistPath,
  getBenchmarkPackageRoot,
  getBenchmarkSkillPath,
} from "./fixtures.js";

export type BrowserBenchmarkCase = {
  benchmark: string;
  id: string;
  title: string;
  startUrl: string;
  instruction: string;
  successAssertion: string;
  runGroup?: string;
  requiredTranscriptSnippets?: string[];
  finalResultInstruction?: string;
};

type BenchmarkRunPaths = {
  runRoot: string;
  logsDir: string;
  workspaceDir: string;
  resultsJsonPath: string;
  transcriptJsonPath: string;
  transcriptMarkdownPath: string;
  eventsLogPath: string;
  sdkMessagesLogPath: string;
};

type BenchmarkRunArtifacts = {
  prompt: string;
  response?: EvalResponse;
  error?: unknown;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCostUsd: number | null;
  usage: NonNullableUsage | null;
  modelUsage: Record<string, ModelUsage> | null;
  status: "running" | "passed" | "failed";
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function formatBenchmarkSessionName(
  benchmark: string,
  caseId: string,
): string {
  return slugify(`${benchmark}-${caseId}`);
}

function deriveRunGroup(testCase: BrowserBenchmarkCase): string {
  if (testCase.runGroup?.trim()) {
    return slugify(testCase.runGroup);
  }

  const titlePrefix =
    testCase.title.includes(":") ? testCase.title.split(":")[0]?.trim() : null;
  if (titlePrefix) {
    return slugify(titlePrefix);
  }

  try {
    const hostname = new URL(testCase.startUrl).hostname.replace(/^www\./, "");
    const primarySegment = hostname.split(".")[0];
    if (primarySegment) {
      return slugify(primarySegment);
    }
  } catch {
    // Fall through to benchmark name.
  }

  return slugify(testCase.benchmark);
}

function getRunName(testCase: BrowserBenchmarkCase): string {
  const group = deriveRunGroup(testCase);
  const runSlug = slugify(`${testCase.id} ${testCase.title}`);
  if (!group || runSlug.startsWith(`${group}-`) || runSlug === group) {
    return runSlug;
  }
  return `${group}-${runSlug}`;
}

function getSessionName(testCase: BrowserBenchmarkCase): string {
  return formatBenchmarkSessionName(testCase.benchmark, testCase.id);
}

function getRunPaths(testCase: BrowserBenchmarkCase): BenchmarkRunPaths {
  const packageRoot = getBenchmarkPackageRoot();
  const runRoot = resolve(
    packageRoot,
    "benchmarks",
    testCase.benchmark,
    "runs",
    getRunName(testCase),
  );

  return {
    runRoot,
    logsDir: join(runRoot, "logs"),
    workspaceDir: join(runRoot, "workspace"),
    resultsJsonPath: join(runRoot, "results.json"),
    transcriptJsonPath: join(runRoot, "transcript.json"),
    transcriptMarkdownPath: join(runRoot, "transcript.md"),
    eventsLogPath: join(runRoot, "logs", "events.jsonl"),
    sdkMessagesLogPath: join(runRoot, "logs", "claude-sdk-messages.jsonl"),
  };
}

function normalizeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? "",
    };
  }
  return error ?? null;
}

function extractFinalResultLine(transcript: string): string | null {
  const finalResultLine = transcript
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("FINAL_RESULT:"));
  return finalResultLine ?? null;
}

function buildPrompt(testCase: BrowserBenchmarkCase): string {
  const session = getSessionName(testCase);

  return [
    `Run the ${testCase.benchmark} browser benchmark case "${testCase.title}".`,
    "Solve it by browsing the live website with the Libretto CLI installed in the current workspace.",
    "The current workspace already contains the built Libretto CLI and the Libretto skill at .agents/skills/libretto/SKILL.md.",
    "Do not change directories or reference any other libretto checkout.",
    "Run all commands from the current working directory and use `pnpm cli ...` directly.",
    "Do not inspect files under benchmarks/ to discover the answer.",
    "Do not use curl, raw fetches, search engines, or non-Libretto browser tooling to solve the task.",
    `Use exactly one Libretto session named "${session}".`,
    `Open the site with: pnpm cli open ${testCase.startUrl} --headless --session ${session}`,
    `Use pnpm cli snapshot --session ${session} --objective "<...>" at least once before your final answer.`,
    `Before finishing, run: pnpm cli exec --session ${session} "return { url: await page.url(), title: await page.title() }"`,
    `Then close the browser with: pnpm cli close --session ${session}`,
    testCase.finalResultInstruction ??
      'End with exactly one line in this format: FINAL_RESULT: <url> | <title>',
    "",
    "Task:",
    testCase.instruction,
  ].join("\n");
}

function clipForMarkdown(text: string, maxChars: number = 6_000): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars / 2));
  const tailChars = Math.max(1, maxChars - headChars);
  return [
    text.slice(0, headChars),
    "",
    `[truncated: showing first ${headChars} chars and last ${tailChars} chars of ${text.length}]`,
    "",
    text.slice(-tailChars),
  ].join("\n");
}

function stripPnpmCliPrelude(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length < 3) {
    return text;
  }

  const firstLine = lines[0]?.trim() ?? "";
  const secondLine = lines[1]?.trim() ?? "";
  if (
    !firstLine.startsWith("> ") ||
    !firstLine.includes("@ cli ") ||
    !secondLine.startsWith("> ") ||
    !secondLine.includes("node ./dist/cli/index.js")
  ) {
    return text;
  }

  let startIndex = 2;
  while (startIndex < lines.length && lines[startIndex]?.trim() === "") {
    startIndex += 1;
  }

  return lines.slice(startIndex).join("\n");
}

function formatToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return clipForMarkdown(content);
  }
  if (Array.isArray(content)) {
    const parts = content.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const typedItem = item as Record<string, unknown>;
      if (typedItem.type === "text" && typeof typedItem.text === "string") {
        return [typedItem.text];
      }
      return [JSON.stringify(item)];
    });
    return clipForMarkdown(parts.join("\n\n"));
  }
  return clipForMarkdown(JSON.stringify(content, null, 2));
}

type PendingToolUse = {
  name: string;
  input: unknown;
};

function formatToolBlock(
  toolName: string,
  input: unknown,
  output: string,
  isError: boolean,
): string {
  const sections = [
    `[${toolName}:`,
    JSON.stringify(input ?? {}, null, 2),
  ];

  if (output.trim().length > 0) {
    sections.push("");
    sections.push(isError ? "Error:" : "Output:");
    sections.push(output.trim());
  }

  sections.push("]");
  return sections.join("\n");
}

function formatTranscriptMarkdown(prompt: string, messages: SDKMessage[]): string {
  const blocks: string[] = [`User:\n${prompt}`];
  const pendingToolUses = new Map<string, PendingToolUse>();

  for (const message of messages) {
    if (message.type === "assistant") {
      const content = message.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const typedBlock = block as Record<string, unknown>;

        if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
          blocks.push(`Assistant:\n${typedBlock.text.trim()}`);
          continue;
        }

        if (
          typedBlock.type === "thinking" &&
          typeof typedBlock.thinking === "string"
        ) {
          blocks.push(`[Thinking: ${typedBlock.thinking.trim()}]`);
          continue;
        }

        if (typedBlock.type === "redacted_thinking") {
          blocks.push("[Thinking: <redacted>]");
          continue;
        }

        if (typedBlock.type === "tool_use") {
          const toolUseId =
            typeof typedBlock.id === "string" ? typedBlock.id : undefined;
          const toolName =
            typeof typedBlock.name === "string" && typedBlock.name.length > 0
              ? typedBlock.name
              : "Tool";
          const input = typedBlock.input ?? {};

          if (toolUseId) {
            pendingToolUses.set(toolUseId, { name: toolName, input });
          } else {
            blocks.push(formatToolBlock(toolName, input, "", false));
          }
        }
      }

      continue;
    }

    if (message.type !== "user") continue;
    const content = message.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const typedBlock = block as Record<string, unknown>;

      if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
        blocks.push(`User:\n${typedBlock.text.trim()}`);
        continue;
      }

      if (typedBlock.type !== "tool_result") continue;

      const toolUseId =
        typeof typedBlock.tool_use_id === "string"
          ? typedBlock.tool_use_id
          : undefined;
      const toolUse = toolUseId ? pendingToolUses.get(toolUseId) : undefined;
      const isError = typedBlock.is_error === true;
      const rawOutput = formatToolResultContent(typedBlock.content);
      const output =
        toolUse?.name === "Bash" ? stripPnpmCliPrelude(rawOutput) : rawOutput;

      if (toolUseId) {
        pendingToolUses.delete(toolUseId);
      }

      if (toolUse) {
        blocks.push(
          formatToolBlock(toolUse.name, toolUse.input, output, isError),
        );
        continue;
      }

      const prefix = isError ? "User (tool error):" : "User:";
      blocks.push(`${prefix}\n${output}`);
    }
  }

  return blocks.filter(Boolean).join("\n\n---\n\n");
}

async function writeJsonl(path: string, values: unknown[]): Promise<void> {
  const contents =
    values.map((value) => JSON.stringify(value)).join("\n") +
    (values.length > 0 ? "\n" : "");
  await writeFile(path, contents, "utf8");
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function copyJsonlLogs(workspaceDir: string, logsDir: string): Promise<void> {
  const sessionsRoot = join(workspaceDir, ".libretto", "sessions");
  try {
    const rootStats = await stat(sessionsRoot);
    if (!rootStats.isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const filePath of await walkFiles(sessionsRoot)) {
    if (!filePath.endsWith(".jsonl")) continue;
    const destination = join(
      logsDir,
      "libretto",
      relative(sessionsRoot, filePath),
    );
    await mkdir(dirname(destination), { recursive: true });
    await cp(filePath, destination);
  }
}

async function createWorkspacePackageJson(
  workspaceDir: string,
  testCase: BrowserBenchmarkCase,
): Promise<void> {
  const packageJsonPath = join(workspaceDir, "package.json");
  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: `libretto-benchmark-${slugify(testCase.benchmark)}-${slugify(testCase.id)}`,
        private: true,
        type: "module",
        scripts: {
          cli: "LIBRETTO_REPO_ROOT=. node ./dist/cli/index.js",
        },
        bin: {
          libretto: "./dist/cli/index.js",
          "libretto-cli": "./dist/cli/index.js",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function createWorkspaceAgentsFile(workspaceDir: string): Promise<void> {
  await writeFile(
    join(workspaceDir, "AGENTS.md"),
    [
      "# Benchmark Workspace Rules",
      "",
      "- Stay in this workspace. Do not `cd` into any other directory or checkout.",
      "- Use the local Libretto CLI via `pnpm cli ...` from this directory.",
      "- Use the local Libretto skill at `.agents/skills/libretto/SKILL.md`.",
      "- Do not rely on any external libretto checkout or globally installed repo copy.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function createWorkspaceFiles(
  testCase: BrowserBenchmarkCase,
  paths: BenchmarkRunPaths,
): Promise<void> {
  await rm(paths.runRoot, { recursive: true, force: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.workspaceDir, { recursive: true });

  const distDestination = join(paths.workspaceDir, "dist");
  const skillDestination = join(
    paths.workspaceDir,
    ".agents",
    "skills",
    "libretto",
    "SKILL.md",
  );

  await cp(getBenchmarkDistPath(), distDestination, { recursive: true });
  await mkdir(dirname(skillDestination), { recursive: true });
  await cp(getBenchmarkSkillPath(), skillDestination);
  await createWorkspacePackageJson(paths.workspaceDir, testCase);
  await createWorkspaceAgentsFile(paths.workspaceDir);

  writeAiConfig(
    "claude",
    [process.execPath, getBenchmarkAnalyzerPath()],
    join(paths.workspaceDir, ".libretto", "config.json"),
  );
}

async function persistArtifacts(
  testCase: BrowserBenchmarkCase,
  paths: BenchmarkRunPaths,
  artifacts: BenchmarkRunArtifacts,
  options: {
    includeLogs: boolean;
  },
): Promise<void> {
  const sdkMessages = artifacts.response?.messages ?? [];
  const transcript = artifacts.response?.transcript ?? "";
  const normalizedError = normalizeError(artifacts.error);
  const success =
    artifacts.status === "passed"
      ? true
      : artifacts.status === "failed"
        ? false
        : null;
  const completed = artifacts.status !== "running";

  await writeFile(
    paths.resultsJsonPath,
    JSON.stringify(
      {
        benchmark: testCase.benchmark,
        caseId: testCase.id,
        title: testCase.title,
        runRoot: paths.runRoot,
        workspaceDir: paths.workspaceDir,
        prompt: artifacts.prompt,
        sessionId: artifacts.response?.sessionId ?? null,
        startedAt: artifacts.startedAt,
        finishedAt: artifacts.finishedAt,
        durationMs: artifacts.durationMs,
        totalCostUsd: artifacts.totalCostUsd,
        usage: artifacts.usage,
        modelUsage: artifacts.modelUsage,
        status: artifacts.status,
        completed,
        success,
        finalResult: extractFinalResultLine(transcript),
        error: normalizedError,
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    paths.transcriptJsonPath,
    JSON.stringify(
      {
        benchmark: testCase.benchmark,
        caseId: testCase.id,
        title: testCase.title,
        prompt: artifacts.prompt,
        sessionId: artifacts.response?.sessionId ?? null,
        startedAt: artifacts.startedAt,
        finishedAt: artifacts.finishedAt,
        durationMs: artifacts.durationMs,
        totalCostUsd: artifacts.totalCostUsd,
        usage: artifacts.usage,
        modelUsage: artifacts.modelUsage,
        status: artifacts.status,
        completed,
        transcript,
        result: artifacts.response?.result ?? null,
        messages: sdkMessages,
        error: normalizedError,
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    paths.transcriptMarkdownPath,
    [
      "# Benchmark Transcript",
      "",
      `- Benchmark: ${testCase.benchmark}`,
      `- Case ID: ${testCase.id}`,
      `- Title: ${testCase.title}`,
      `- Run Root: ${paths.runRoot}`,
      `- Workspace: ${paths.workspaceDir}`,
      `- Session ID: ${artifacts.response?.sessionId ?? "n/a"}`,
      `- Status: ${artifacts.status}`,
      `- Success: ${success === null ? "n/a" : success}`,
      `- Final Result: ${extractFinalResultLine(transcript) ?? "n/a"}`,
      `- Started: ${artifacts.startedAt}`,
      `- Finished: ${artifacts.finishedAt}`,
      `- Duration (ms): ${artifacts.durationMs}`,
      `- Total Cost (USD): ${artifacts.totalCostUsd ?? "n/a"}`,
      "",
      "## Transcript",
      "",
      formatTranscriptMarkdown(artifacts.prompt, sdkMessages),
    ].join("\n"),
    "utf8",
  );

  await writeJsonl(
    paths.sdkMessagesLogPath,
    sdkMessages.map((message, index) => ({
      index,
      type: message.type,
      message,
    })),
  );

  await writeJsonl(paths.eventsLogPath, [
    {
      event: "benchmark_run",
      benchmark: testCase.benchmark,
      caseId: testCase.id,
      title: testCase.title,
      startedAt: artifacts.startedAt,
      finishedAt: artifacts.finishedAt,
      durationMs: artifacts.durationMs,
      totalCostUsd: artifacts.totalCostUsd,
      sessionId: artifacts.response?.sessionId ?? null,
      status: artifacts.status,
      completed,
      success,
      error:
        artifacts.error instanceof Error
          ? artifacts.error.message
          : artifacts.error ?? null,
    },
  ]);

  if (options.includeLogs) {
    await copyJsonlLogs(paths.workspaceDir, paths.logsDir);
  }
}

class BenchmarkRunPersister {
  private response: EvalResponse | undefined;
  private error: unknown;
  private status: "running" | "passed" | "failed" = "running";
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly testCase: BrowserBenchmarkCase,
    private readonly paths: BenchmarkRunPaths,
    private readonly prompt: string,
    private readonly startedAt: Date,
  ) {}

  updateResponse(response: EvalResponse): void {
    this.response = response;
    this.queuePersist({ includeLogs: false });
  }

  updateFailure(error: unknown): void {
    this.error = error;
    this.status = "failed";
    this.queuePersist({ includeLogs: false });
  }

  queueInitialSnapshot(): void {
    this.queuePersist({ includeLogs: false });
  }

  async finalize(args: {
    response?: EvalResponse;
    error?: unknown;
    status: "passed" | "failed";
  }): Promise<void> {
    this.response = args.response ?? this.response;
    this.error = args.error ?? this.error;
    this.status = args.status;
    this.queuePersist({ includeLogs: true });
    await this.persistChain;
  }

  private queuePersist(options: { includeLogs: boolean }): void {
    const artifacts = this.buildArtifacts();
    this.persistChain = this.persistChain
      .catch(() => {})
      .then(() =>
        persistArtifacts(this.testCase, this.paths, artifacts, options),
      );
  }

  private buildArtifacts(): BenchmarkRunArtifacts {
    const finishedAt = new Date();
    return {
      prompt: this.prompt,
      response: this.response,
      error: this.error,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      totalCostUsd: this.response?.totalCostUsd ?? null,
      usage: this.response?.usage ?? null,
      modelUsage: this.response?.modelUsage ?? null,
      status: this.status,
    };
  }
}

async function withHarness<T>(
  workspaceDir: string,
  run: (harness: ClaudeEvalHarness) => Promise<T>,
): Promise<T> {
  const harness = await createClaudeBenchmarkHarness(workspaceDir);
  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}

export async function runBrowserBenchmarkCase(
  testCase: BrowserBenchmarkCase,
): Promise<EvalResponse> {
  const paths = getRunPaths(testCase);
  const prompt = buildPrompt(testCase);
  const startedAt = new Date();

  await createWorkspaceFiles(testCase, paths);

  const persister = new BenchmarkRunPersister(
    testCase,
    paths,
    prompt,
    startedAt,
  );
  persister.queueInitialSnapshot();

  let response: EvalResponse | undefined;
  let error: unknown;

  try {
    response = await withHarness(paths.workspaceDir, async (harness) => {
      const agentResponse = await harness.send(prompt, {
        onUpdate: (partialResponse) => {
          persister.updateResponse(partialResponse);
        },
      });
      response = agentResponse;

      expect(agentResponse.messages.length).toBeGreaterThan(0);
      expect(agentResponse.transcript).toContain("FINAL_RESULT:");

      for (const snippet of testCase.requiredTranscriptSnippets ?? []) {
        expect(agentResponse.transcript).toContain(snippet);
      }

      await agentResponse.evaluate(testCase.successAssertion);
      return agentResponse;
    });

    return response;
  } catch (caughtError) {
    error = caughtError;
    persister.updateFailure(caughtError);
    throw caughtError;
  } finally {
    await persister.finalize({
      response,
      error,
      status: error ? "failed" : "passed",
    });
  }
}
