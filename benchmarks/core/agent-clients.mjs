import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function resolveClaudeBinary() {
  const localClaude = join(process.env.HOME ?? "", ".claude", "local", "claude");
  return existsSync(localClaude) ? localClaude : "claude";
}

const FALLBACK_PREFIXES = {
  codex: ["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write"],
  claude: [resolveClaudeBinary(), "-p"],
};

const FINAL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    final_result_response: { type: "string" },
    notes: { type: "string" },
    task_status: {
      type: "string",
      enum: ["completed", "failed"],
    },
  },
  required: ["final_result_response", "notes", "task_status"],
  additionalProperties: false,
};

export function resolveCommandPrefix(options) {
  if (options.agentBin) {
    return [options.agentBin, ...(options.agentArgs ?? [])];
  }

  return FALLBACK_PREFIXES[options.agentType];
}

function parseStrictJson(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    throw new Error("Agent did not return JSON output.");
  }
  return JSON.parse(text);
}

function validateBenchmarkResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Agent output JSON must be an object.");
  }

  const finalResult = payload.final_result_response;
  const notes = payload.notes;
  const status = payload.task_status;

  if (typeof finalResult !== "string") {
    throw new Error("Agent output JSON missing string field: final_result_response.");
  }
  if (typeof notes !== "string") {
    throw new Error("Agent output JSON missing string field: notes.");
  }
  if (status !== "completed" && status !== "failed") {
    throw new Error("Agent output JSON has invalid task_status (must be completed|failed).");
  }

  return {
    final_result_response: finalResult,
    notes,
    task_status: status,
  };
}

function buildTaskPrompt(options) {
  const modelLine = options.model ? `Preferred model: ${options.model}` : "Preferred model: default";

  return [
    "You are running an Online-Mind2Web browser benchmark task using Libretto.",
    "",
    "Rules:",
    `- Use only this session: ${options.sessionName}`,
    "- Use the default coding-agent harness and bash tool for all work.",
    "- First reference .agents/skills/libretto/SKILL.md for command patterns.",
    "- Do not modify repository source files or docs.",
    "- Do not ask user questions.",
    "- Solve from current page state only.",
    "- For CLI commands in this repo, use prefix: pnpm --filter libretto-cli exec node dist/index.js",
    "- Useful commands: snapshot, exec, actions, network.",
    `- Max meaningful browser actions: ${options.maxSteps}`,
    modelLine,
    "",
    "Task:",
    `- task_id: ${options.taskId}`,
    `- start_url: ${options.startUrl}`,
    `- instruction: ${options.instruction}`,
    "",
    "Return ONLY valid JSON with this schema:",
    "{",
    '  "final_result_response": "<final answer>",',
    '  "notes": "<brief summary or blocker>",',
    '  "task_status": "completed|failed"',
    "}",
    "",
    "No markdown or code fences.",
  ].join("\n");
}

function runProcess(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2_000);
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
    }
    child.stdin.end();
  });
}

class BaseHarnessAgentClient {
  constructor(options) {
    this.agentType = options.agentType;
    this.commandPrefix = options.commandPrefix;
    this.model = options.model;
    this.modelFlag = options.modelFlag;
    this.timeoutMs = options.timeoutMs;

    if (!this.commandPrefix?.[0]) {
      throw new Error(`Missing command prefix for ${this.agentType} agent.`);
    }
  }

  get command() {
    return this.commandPrefix[0];
  }

  get baseArgs() {
    return this.commandPrefix.slice(1);
  }

  maybeModelArgs() {
    if (!this.model) return [];

    return [this.modelFlag || "--model", this.model];
  }

  async runTask(input) {
    const prompt = buildTaskPrompt({
      taskId: input.taskId,
      instruction: input.instruction,
      startUrl: input.startUrl,
      sessionName: input.sessionName,
      maxSteps: input.maxSteps,
      model: this.model,
    });

    const startedAt = Date.now();
    try {
      const result = await this.invoke(prompt);
      const durationMs = Date.now() - startedAt;
      const parsed = validateBenchmarkResponse(result.parsedOutput);

      return {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs,
        rawStdout: result.stdout,
        rawStderr: result.stderr,
        finalResult: parsed.final_result_response,
        parsedJson: parsed,
        prompt,
        command: this.command,
        args: this.lastArgs ?? [],
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      return {
        exitCode: 1,
        timedOut: false,
        durationMs,
        rawStdout: "",
        rawStderr: message,
        finalResult: `Agent output error: ${message}`,
        parsedJson: {
          final_result_response: `Agent output error: ${message}`,
          notes: message,
          task_status: "failed",
        },
        prompt,
        command: this.command,
        args: this.lastArgs ?? [],
      };
    }
  }
}

class CodexHarnessAgentClient extends BaseHarnessAgentClient {
  async invoke(prompt) {
    const tempDir = mkdtempSync(join(tmpdir(), "libretto-benchmark-codex-"));
    const outputPath = join(tempDir, "last-message.json");

    try {
      const schemaPath = join(tempDir, "benchmark-output-schema.json");
      const args = [
        ...this.baseArgs,
        ...this.maybeModelArgs(),
        "--json",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ];
      this.lastArgs = args;

      writeFileSync(schemaPath, JSON.stringify(FINAL_RESPONSE_SCHEMA, null, 2), "utf8");

      const result = await runProcess(this.command, args, {
        stdinText: prompt,
        timeoutMs: this.timeoutMs,
      });

      const outputText = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
      const parsedOutput = parseStrictJson(outputText);
      return {
        ...result,
        outputText,
        parsedOutput,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

class ClaudeHarnessAgentClient extends BaseHarnessAgentClient {
  async invoke(prompt) {
    const args = [
      ...this.baseArgs,
      ...this.maybeModelArgs(),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(FINAL_RESPONSE_SCHEMA),
      prompt,
    ];
    this.lastArgs = args;
    const result = await runProcess(this.command, args, {
      timeoutMs: this.timeoutMs,
    });

    const envelope = parseStrictJson(result.stdout);
    const parsedOutput =
      envelope && typeof envelope === "object" && envelope.structured_output
        ? envelope.structured_output
        : envelope;

    return {
      ...result,
      parsedOutput,
    };
  }
}

export function createAgentClient(options) {
  if (options.agentType === "codex") {
    return new CodexHarnessAgentClient(options);
  }
  if (options.agentType === "claude") {
    return new ClaudeHarnessAgentClient(options);
  }
  throw new Error(`Unsupported agent type: ${options.agentType}`);
}
