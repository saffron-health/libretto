import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createAgentClient, resolveCommandPrefix } from "../core/agent-clients.mjs";

const DEFAULT_DATASET_URL =
  "https://raw.githubusercontent.com/browserbase/stagehand/main/packages/evals/datasets/onlineMind2Web/onlineMind2Web.jsonl";

function printUsage() {
  console.log(`onlineMind2Web benchmark runner

Usage:
  pnpm benchmark onlineMind2Web --agent <codex|claude> [options]

Required:
  --agent <type>         Agent backend to run (codex or claude)

Agent options:
  --model <name>         Optional model name passed to harness
  --model-flag <flag>    Optional model flag (ex: --model)
  --agent-bin <path>     Override agent executable path
  --agent-arg <value>    Extra agent arg (repeatable)
  --agent-timeout-ms <n> Agent call timeout per task (default: 600000)
  --max-steps <n>        Max meaningful browser actions hint (default: 30)

Benchmark options:
  --dataset <path|url>   JSONL dataset path or URL (default: stagehand mirror)
  --output <path>        Output directory (default: benchmarks/results/onlineMind2Web/<timestamp>)
  --limit <n>            Number of tasks to run (default: 25)
  --offset <n>           Start offset in dataset (default: 0)
  --task-id <id>         Run only this task id (repeatable)
  --session-prefix <s>   Session name prefix (default: benchmark-online-mind2web)
  --headed               Run browser headed (default: headless)
  --headless             Force headless mode
  --dry-run              Print planned runs without executing workflows

Examples:
  pnpm benchmark onlineMind2Web --agent claude --model claude-sonnet-4-5 --limit 5
  pnpm benchmark onlineMind2Web --agent codex --model gpt-5 --model-flag --model --limit 5
  pnpm benchmark onlineMind2Web --agent codex --agent-bin codex --agent-arg exec --agent-arg --skip-git-repo-check
`);
}

function parseArgs(rawArgs) {
  const args = {
    agent: "",
    model: "",
    modelFlag: "",
    agentBin: "",
    agentArgs: [],
    agentTimeoutMs: 600_000,
    maxSteps: 30,
    dataset: DEFAULT_DATASET_URL,
    outputDir: "",
    limit: 25,
    offset: 0,
    headed: false,
    dryRun: false,
    taskIds: [],
    sessionPrefix: "benchmark-online-mind2web",
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      case "--agent":
        args.agent = String(rawArgs[i + 1] ?? "").trim().toLowerCase();
        i += 1;
        break;
      case "--model":
        args.model = String(rawArgs[i + 1] ?? "").trim();
        i += 1;
        break;
      case "--model-flag":
        args.modelFlag = String(rawArgs[i + 1] ?? "").trim();
        i += 1;
        break;
      case "--agent-bin":
        args.agentBin = String(rawArgs[i + 1] ?? "").trim();
        i += 1;
        break;
      case "--agent-arg": {
        const value = String(rawArgs[i + 1] ?? "");
        if (!value) {
          throw new Error("--agent-arg requires a value.");
        }
        args.agentArgs.push(value);
        i += 1;
        break;
      }
      case "--agent-timeout-ms": {
        const value = Number(rawArgs[i + 1]);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --agent-timeout-ms value: ${rawArgs[i + 1]}`);
        }
        args.agentTimeoutMs = Math.floor(value);
        i += 1;
        break;
      }
      case "--max-steps": {
        const value = Number(rawArgs[i + 1]);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --max-steps value: ${rawArgs[i + 1]}`);
        }
        args.maxSteps = Math.floor(value);
        i += 1;
        break;
      }
      case "--dataset":
        args.dataset = String(rawArgs[i + 1] ?? "").trim();
        i += 1;
        break;
      case "--output":
        args.outputDir = String(rawArgs[i + 1] ?? "").trim();
        i += 1;
        break;
      case "--limit": {
        const value = Number(rawArgs[i + 1]);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --limit value: ${rawArgs[i + 1]}`);
        }
        args.limit = Math.floor(value);
        i += 1;
        break;
      }
      case "--offset": {
        const value = Number(rawArgs[i + 1]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Invalid --offset value: ${rawArgs[i + 1]}`);
        }
        args.offset = Math.floor(value);
        i += 1;
        break;
      }
      case "--task-id": {
        const value = String(rawArgs[i + 1] ?? "").trim();
        if (!value) {
          throw new Error("--task-id requires a value");
        }
        args.taskIds.push(value);
        i += 1;
        break;
      }
      case "--session-prefix": {
        const value = String(rawArgs[i + 1] ?? "").trim();
        if (!value) {
          throw new Error("--session-prefix requires a value");
        }
        args.sessionPrefix = value;
        i += 1;
        break;
      }
      case "--headed":
        args.headed = true;
        break;
      case "--headless":
        args.headed = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.agent !== "codex" && args.agent !== "claude") {
    throw new Error("Missing or invalid --agent. Use one of: codex, claude.");
  }

  return args;
}

function createDefaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return resolve("benchmarks", "results", "onlineMind2Web", stamp);
}

async function readDatasetText(datasetPathOrUrl) {
  const trimmed = datasetPathOrUrl.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  const absolutePath = resolve(trimmed);
  if (!existsSync(absolutePath)) {
    throw new Error(`Dataset not found at path: ${absolutePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function parseDataset(text) {
  const rows = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof parsed?.task_id === "string" &&
      typeof parsed?.confirmed_task === "string" &&
      typeof parsed?.website === "string"
    ) {
      rows.push(parsed);
    }
  }
  return rows;
}

function sanitizeSessionName(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines.
    }
  }
  return parsed;
}

function toActionHistory(actions) {
  return actions
    .filter((record) => record && record.source === "agent")
    .map((record) => {
      const action = String(record.action ?? "unknown").toUpperCase();
      const subjectRaw =
        typeof record.selector === "string"
          ? record.selector
          : typeof record.url === "string"
            ? record.url
            : typeof record.value === "string"
              ? record.value
              : "unknown";
      const subject = subjectRaw.replace(/\s+/g, " ").trim().slice(0, 220);
      return `<${subject || "unknown"}> -> ${action}`;
    });
}

function copyTrajectoryScreenshots(sessionDir, taskOutputDir) {
  const logsDir = join(sessionDir, "logs");
  const snapshotsDir = join(sessionDir, "snapshots");
  const trajectoryDir = join(taskOutputDir, "trajectory");
  mkdirSync(trajectoryDir, { recursive: true });

  const screenshots = [];

  if (existsSync(logsDir)) {
    readdirSync(logsDir)
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .forEach((fileName) => {
        const fullPath = join(logsDir, fileName);
        const stat = statSync(fullPath);
        screenshots.push({ fullPath, mtimeMs: stat.mtimeMs });
      });
  }

  if (existsSync(snapshotsDir)) {
    readdirSync(snapshotsDir).forEach((entryName) => {
      const snapshotPath = join(snapshotsDir, entryName, "page.png");
      if (!existsSync(snapshotPath)) return;
      const stat = statSync(snapshotPath);
      screenshots.push({ fullPath: snapshotPath, mtimeMs: stat.mtimeMs });
    });
  }

  if (screenshots.length === 0) return [];

  screenshots.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const copied = [];
  screenshots.forEach((entry, index) => {
    const targetName = `${index}_full_screenshot.png`;
    const targetPath = join(trajectoryDir, targetName);
    copyFileSync(entry.fullPath, targetPath);
    copied.push(targetPath);
  });

  return copied;
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    if (options.captureOutput) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (error) => rejectPromise(error));
    child.on("close", (code) =>
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
      }),
    );
  });
}

const LIBRETTO_CLI_DIST = resolve("packages", "libretto-cli", "dist", "index.js");

async function ensureLibrettoCliBuilt() {
  if (existsSync(LIBRETTO_CLI_DIST)) return;
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const buildResult = await runCommand(pnpmBin, ["--filter", "libretto-cli", "build"]);
  if (buildResult.exitCode !== 0 || !existsSync(LIBRETTO_CLI_DIST)) {
    throw new Error(
      "libretto-cli dist build is missing and build failed. Run 'pnpm --filter libretto-cli build' manually.",
    );
  }
}

function getLibrettoCliArgs(command, ...rest) {
  return ["--filter", "libretto-cli", "exec", "node", "dist/index.js", command, ...rest];
}

async function openSession({ startUrl, sessionName, headed }) {
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = getLibrettoCliArgs(
    "open",
    startUrl,
    "--session",
    sessionName,
    headed ? "--headed" : "--headless",
  );
  return await runCommand(pnpmBin, args);
}

async function closeSession(sessionName) {
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = getLibrettoCliArgs("close", "--session", sessionName);
  return await runCommand(pnpmBin, args, { captureOutput: true });
}

function writeTaskResult({
  task,
  outputRoot,
  sessionName,
  runInfo,
  agentRun,
}) {
  const taskOutputDir = join(outputRoot, task.task_id);
  const sessionDir = join(".libretto", "sessions", sessionName);
  const actionLogPath = join(sessionDir, "actions.jsonl");
  const actions = readJsonLines(actionLogPath);
  const actionHistory = toActionHistory(actions);
  const screenshotPaths = copyTrajectoryScreenshots(sessionDir, taskOutputDir);

  const result = {
    task_id: task.task_id,
    task: task.confirmed_task,
    website: task.website,
    final_result_response: agentRun?.finalResult ?? "",
    action_history: actionHistory,
    thoughts: [],
    run_metadata: {
      session: sessionName,
      status: runInfo.status,
      duration_ms: runInfo.durationMs,
      open_exit_code: runInfo.openExitCode,
      agent_exit_code: agentRun?.exitCode ?? null,
      agent_timed_out: agentRun?.timedOut ?? false,
      close_exit_code: runInfo.closeExitCode,
      agent: runInfo.agent,
      model: runInfo.model,
      command: runInfo.command,
      args: runInfo.commandArgs,
      screenshots_copied: screenshotPaths.length,
    },
  };

  writeFileSync(join(taskOutputDir, "result.json"), JSON.stringify(result, null, 2), "utf8");

  if (agentRun) {
    writeFileSync(
      join(taskOutputDir, "agent-output.txt"),
      `STDOUT:\n${agentRun.rawStdout ?? ""}\n\nSTDERR:\n${agentRun.rawStderr ?? ""}\n`,
      "utf8",
    );
  }

  return result;
}

async function runSingleTask({
  task,
  taskIndex,
  args,
  outputRoot,
  agentClient,
  agentLabel,
}) {
  const taskOutputDir = join(outputRoot, task.task_id);
  mkdirSync(taskOutputDir, { recursive: true });

  const shortTaskId = task.task_id.slice(0, 16);
  const sessionName = sanitizeSessionName(
    `${args.sessionPrefix}-${taskIndex + args.offset}-${shortTaskId}`,
  );

  if (args.dryRun) {
    return {
      sessionName,
      result: {
        task_id: task.task_id,
        task: task.confirmed_task,
        website: task.website,
        final_result_response: "",
        action_history: [],
        thoughts: [],
        run_metadata: {
          session: sessionName,
          status: "dry-run",
          agent: args.agent,
          model: args.model,
          command: agentLabel,
          args: [],
        },
      },
    };
  }

  const startedAt = Date.now();
  let openExitCode = 1;
  let closeExitCode = null;
  let status = "failed";
  let agentRun = null;
  let commandArgs = agentClient.baseArgs ?? [];

  try {
    const openResult = await openSession({
      startUrl: task.website,
      sessionName,
      headed: args.headed,
    });
    openExitCode = openResult.exitCode;
    if (openResult.exitCode !== 0) {
      status = "failed_to_open";
    } else {
      agentRun = await agentClient.runTask({
        taskId: task.task_id,
        instruction: task.confirmed_task,
        startUrl: task.website,
        sessionName,
        maxSteps: args.maxSteps,
      });

      commandArgs = agentRun.args;
      const reportedTaskStatus =
        typeof agentRun.parsedJson?.task_status === "string"
          ? agentRun.parsedJson.task_status.toLowerCase()
          : "";
      status =
        agentRun.exitCode === 0 && !agentRun.timedOut
          ? reportedTaskStatus === "failed"
            ? "agent_reported_failed"
            : "completed"
          : agentRun.timedOut
            ? "agent_timeout"
            : "agent_failed";
    }
  } finally {
    try {
      const closeResult = await closeSession(sessionName);
      closeExitCode = closeResult.exitCode;
    } catch {
      closeExitCode = 1;
    }
  }

  return {
    sessionName,
    result: writeTaskResult({
      task,
      outputRoot,
      sessionName,
      runInfo: {
        status,
        durationMs: Date.now() - startedAt,
        openExitCode,
        closeExitCode,
        agent: args.agent,
        model: args.model,
        command: agentLabel,
        commandArgs,
      },
      agentRun,
    }),
  };
}

export async function runOnlineMind2WebBenchmark(rawArgs) {
  let args;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  const outputRoot = args.outputDir ? resolve(args.outputDir) : createDefaultOutputDir();
  mkdirSync(outputRoot, { recursive: true });

  const commandPrefix = resolveCommandPrefix({
    agentType: args.agent,
    agentBin: args.agentBin,
    agentArgs: args.agentArgs,
  });

  const agentClient = createAgentClient({
    agentType: args.agent,
    commandPrefix,
    model: args.model || undefined,
    modelFlag: args.modelFlag || undefined,
    timeoutMs: args.agentTimeoutMs,
  });

  console.log(`Loading dataset: ${args.dataset}`);
  await ensureLibrettoCliBuilt();
  const datasetText = await readDatasetText(args.dataset);
  const rows = parseDataset(datasetText);
  if (rows.length === 0) {
    throw new Error("Dataset did not contain valid onlineMind2Web rows.");
  }

  const filteredRows =
    args.taskIds.length > 0
      ? rows.filter((row) => args.taskIds.includes(row.task_id))
      : rows;

  if (filteredRows.length === 0) {
    throw new Error("No tasks matched the provided filters.");
  }

  const selected = filteredRows.slice(args.offset, args.offset + args.limit);
  if (selected.length === 0) {
    throw new Error(
      `No tasks selected after offset/limit (offset=${args.offset}, limit=${args.limit}).`,
    );
  }

  console.log(`Running ${selected.length} task(s). Output: ${outputRoot}`);
  console.log(`Agent: ${args.agent} harness | Command: ${commandPrefix.join(" ")}`);

  const summary = {
    benchmark: "onlineMind2Web",
    dataset: args.dataset,
    agent: args.agent,
    model: args.model || null,
    total: selected.length,
    completed: 0,
    failed: 0,
    output_dir: outputRoot,
    tasks: [],
  };

  for (let index = 0; index < selected.length; index += 1) {
    const task = selected[index];
    console.log(`\n[${index + 1}/${selected.length}] ${task.task_id} ${task.website}`);

    if (args.dryRun) {
      const shortTaskId = task.task_id.slice(0, 16);
      const sessionName = sanitizeSessionName(
        `${args.sessionPrefix}-${index + args.offset}-${shortTaskId}`,
      );
      console.log(`[dry-run] would open session ${sessionName} at ${task.website}`);
      console.log(`[dry-run] would call ${args.agent} agent for task instruction`);
      summary.completed += 1;
      summary.tasks.push({
        task_id: task.task_id,
        session: sessionName,
        status: "dry-run",
        output_dir: join(outputRoot, task.task_id),
      });
      continue;
    }

    const { sessionName, result } = await runSingleTask({
      task,
      taskIndex: index,
      args,
      outputRoot,
      agentClient,
      agentLabel: commandPrefix[0],
    });

    const status = result?.run_metadata?.status ?? "failed";
    if (status === "completed") {
      summary.completed += 1;
    } else {
      summary.failed += 1;
    }

    summary.tasks.push({
      task_id: task.task_id,
      session: sessionName,
      status,
      output_dir: join(outputRoot, task.task_id),
      final_result_response: result.final_result_response,
    });

    writeFileSync(join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }

  if (args.dryRun) {
    writeFileSync(join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }

  console.log("\nBenchmark complete.");
  console.log(
    `Completed: ${summary.completed} | Failed: ${summary.failed} | Total: ${summary.total}`,
  );
  console.log(`Summary: ${join(outputRoot, "summary.json")}`);
  console.log(
    "\nTip: run Online-Mind2Web's evaluator against this output directory via --trajectories_dir.",
  );
}
