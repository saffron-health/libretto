#!/usr/bin/env node
/**
 * Worktree Manager
 *
 * Creates and manages git worktrees for isolated development tasks.
 *
 * Commands:
 *   wt new [prompt]      - Create worktree with AI-generated branch name + agent
 *   wt scratch [--code]  - Create timestamped scratch worktree
 *   wt prune [--force]   - Remove worktrees for branches merged into main
 *
 * The shell wrapper (.bin/wt) captures JSON on stderr to exec into the
 * chosen agent or editor after the CLI completes.
 */

import { generateObject } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { z } from "zod";
import {
  mkdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  openSync,
  closeSync,
} from "node:fs";
import {
  execSync,
  execFileSync,
  spawn,
  type SpawnSyncReturns,
} from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Agent = "opencode" | "pi" | "amp";

const VALID_AGENTS: Agent[] = ["opencode", "pi", "amp"];

// ---------------------------------------------------------------------------
// LLM (Vertex AI via Application Default Credentials)
// ---------------------------------------------------------------------------

const SMALL_MODEL = "gemini-2.5-flash";

function getVertexModel() {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "Google Cloud project not set. Set GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.\n" +
        "Also ensure application default credentials are configured:\n" +
        "  gcloud auth application-default login",
    );
  }
  const vertex = createVertex({
    project,
    location: process.env.GOOGLE_CLOUD_LOCATION || "global",
  });
  return vertex(SMALL_MODEL);
}

// ---------------------------------------------------------------------------
// Git / shell helpers
// ---------------------------------------------------------------------------

function getGitRoot(): string {
  try {
    const out = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { encoding: "utf-8" },
    ).trim();
    return dirname(out);
  } catch {
    throw new Error("Not in a git repository");
  }
}

const ROOT_DIR = getGitRoot();
const WORKTREES_DIR = resolve(ROOT_DIR, ".worktrees");

function git(
  args: string[],
  options?: { cwd?: string },
): { success: boolean; output: string } {
  try {
    const output = execFileSync("git", args, {
      cwd: options?.cwd ?? ROOT_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output };
  } catch (err: unknown) {
    const e = err as SpawnSyncReturns<string> & { message?: string };
    return {
      success: false,
      output: (e.stdout ?? "") + (e.stderr ?? e.message ?? ""),
    };
  }
}

function run(
  cmd: string,
  args: string[],
  options?: { cwd?: string; stdio?: "inherit" | "pipe" },
): { success: boolean; output: string } {
  try {
    if (options?.stdio === "inherit") {
      execFileSync(cmd, args, {
        cwd: options?.cwd ?? ROOT_DIR,
        stdio: "inherit",
      });
      return { success: true, output: "" };
    }
    const output = execFileSync(cmd, args, {
      cwd: options?.cwd ?? ROOT_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output };
  } catch (err: unknown) {
    const e = err as SpawnSyncReturns<string> & { message?: string };
    return {
      success: false,
      output: (e.stdout ?? "") + (e.stderr ?? e.message ?? ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Shared logic
// ---------------------------------------------------------------------------

async function getAuthorInitials(): Promise<string> {
  const result = git(["config", "user.name"]);
  if (!result.success || !result.output.trim()) return "dev";
  const name = result.output.trim();
  const initials = name
    .split(/\s+/)
    .map((part) => part[0]?.toLowerCase() ?? "")
    .join("");
  return initials || "dev";
}

async function generateBranchName(prompt: string): Promise<string> {
  const initials = await getAuthorInitials();
  const prefix = `${initials}-`;

  const model = getVertexModel();
  const result = await generateObject({
    model,
    prompt: `Generate a short, descriptive git branch name from this task description.
Rules:
- Use lowercase letters, numbers, and hyphens only
- Max 30 characters
- Start with "${prefix}"
- Be descriptive but concise
- Output ONLY the branch name

Task: ${prompt.slice(0, 500)}`,
    schema: z.object({
      branchName: z
        .string()
        .describe("The generated branch name, e.g. tk-fix-login-bug"),
    }),
    temperature: 0,
  });

  const name = result.object.branchName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

function drainStdin(): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve();
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("readable", () => {
      while (process.stdin.read() !== null) {
        /* drain */
      }
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    });
    setTimeout(() => {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      process.stdin.pause();
      resolve();
    }, 50);
  });
}

function openEditor(): Promise<string> {
  const tmpFile = join(tmpdir(), `wt-prompt-${Date.now()}.md`);
  writeFileSync(tmpFile, "");

  const editor = process.env.EDITOR ?? "vim";
  const args = editor === "vim" ? ["+startinsert", tmpFile] : [tmpFile];
  const ttyFd = openSync("/dev/tty", "r+");

  return new Promise((resolve, reject) => {
    const child = spawn(editor, args, { stdio: [ttyFd, ttyFd, ttyFd] });

    child.on("close", async (code: number | null) => {
      closeSync(ttyFd);
      if (code !== 0) {
        unlinkSync(tmpFile);
        reject(new Error(`Editor exited with code ${code}`));
        return;
      }
      const content = readFileSync(tmpFile, "utf-8").trim();
      unlinkSync(tmpFile);
      await drainStdin();
      resolve(content);
    });
  });
}

async function createWorktree(branchName: string): Promise<string> {
  mkdirSync(WORKTREES_DIR, { recursive: true });
  git(["fetch", "origin", "main"]);

  const worktreePath = resolve(WORKTREES_DIR, branchName);
  const result = git([
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    "origin/main",
  ]);
  if (!result.success) {
    throw new Error(`Failed to create worktree: ${result.output}`);
  }
  return worktreePath;
}

async function setupWorktree(worktreePath: string): Promise<void> {
  console.log("Installing dependencies...");
  const installResult = run("pnpm", ["install"], {
    cwd: worktreePath,
    stdio: "inherit",
  });
  if (!installResult.success) {
    throw new Error("Failed to install dependencies");
  }

  // Copy .env if it exists
  const sourceEnv = resolve(ROOT_DIR, "apps/api/.env");
  const destEnv = resolve(worktreePath, "apps/api/.env");
  if (existsSync(sourceEnv)) {
    copyFileSync(sourceEnv, destEnv);
  }

  console.log("Building...");
  const buildResult = run("pnpm", ["build"], {
    cwd: worktreePath,
    stdio: "inherit",
  });
  if (!buildResult.success) {
    throw new Error("Failed to build");
  }
}

// ---------------------------------------------------------------------------
// Agent exec builders
//
// Each agent has different CLI flags for accepting an initial prompt.
// The exec JSON is consumed by the shell wrapper (.bin/wt) which
// `exec`s the appropriate command after cd-ing into the worktree.
// ---------------------------------------------------------------------------

function buildExecWithPrompt(
  agent: Agent,
  cwd: string,
  prompt: string,
): object {
  switch (agent) {
    case "opencode":
      // opencode --prompt="..."
      return { exec: { cwd, cmd: "opencode", args: [`--prompt=${prompt}`] } };
    case "pi":
      // pi "prompt text"
      return { exec: { cwd, cmd: "pi", args: [prompt] } };
    case "amp":
      // amp -x "prompt text"
      return { exec: { cwd, cmd: "amp", args: ["-x", prompt] } };
  }
}

function buildExecWithoutPrompt(agent: Agent, cwd: string): object {
  switch (agent) {
    case "opencode":
      return { exec: { cwd, cmd: "opencode", args: [] } };
    case "pi":
      return { exec: { cwd, cmd: "pi", args: [] } };
    case "amp":
      return { exec: { cwd, cmd: "amp", args: [] } };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function newWorktree(agent: Agent, promptArg?: string): Promise<void> {
  let prompt: string;

  if (promptArg) {
    prompt = promptArg;
  } else {
    if (!process.stdin.isTTY) {
      throw new Error("wt new requires a TTY when no prompt is provided");
    }
    prompt = await openEditor();
    if (!prompt) {
      throw new Error("No prompt provided");
    }
  }

  console.log("Generating branch name...");
  const branchName = await generateBranchName(prompt);

  console.log(`Creating worktree: ${branchName}`);
  const worktreePath = await createWorktree(branchName);

  await setupWorktree(worktreePath);

  const fullPrompt = `You're working in a worktree at ${worktreePath}. Scope all your changes to within this worktree.\n\n${prompt}`;
  console.error(
    JSON.stringify(buildExecWithPrompt(agent, worktreePath, fullPrompt)),
  );
}

async function scratchWorktree(agent: Agent, useCode: boolean): Promise<void> {
  const initials = await getAuthorInitials();
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const branchName = `${initials}-${month}${day}-${hours}${minutes}`;

  console.log(`Creating scratch worktree: ${branchName}`);
  const worktreePath = await createWorktree(branchName);

  await setupWorktree(worktreePath);

  if (useCode) {
    console.error(
      JSON.stringify({ exec: { cwd: worktreePath, cmd: "code", args: [] } }),
    );
  } else {
    console.error(JSON.stringify(buildExecWithoutPrompt(agent, worktreePath)));
  }
}

async function pruneWorktrees(force: boolean): Promise<void> {
  git(["fetch", "origin", "main"]);

  const mergedResult = git(["branch", "--merged", "origin/main"]);
  const mergedBranches = new Set(
    mergedResult.output
      .split("\n")
      .map((b) => b.trim().replace(/^[*+] /, ""))
      .filter((b) => b && b !== "main" && b !== "master"),
  );

  const worktreeResult = git(["worktree", "list", "--porcelain"]);
  const worktrees: { path: string; branch: string }[] = [];

  let currentPath = "";
  for (const line of worktreeResult.output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.substring(9);
    } else if (line.startsWith("branch refs/heads/")) {
      const branch = line.substring(18);
      if (currentPath && currentPath.includes(".worktrees")) {
        worktrees.push({ path: currentPath, branch });
      }
    }
  }

  let pruned = 0;
  let failed = 0;
  for (const wt of worktrees) {
    if (mergedBranches.has(wt.branch)) {
      console.log(`Pruning: ${wt.branch}`);
      const removeArgs = force
        ? ["worktree", "remove", "--force", wt.path]
        : ["worktree", "remove", wt.path];
      const removeResult = git(removeArgs);
      if (!removeResult.success) {
        console.error(`  Failed to remove worktree: ${wt.branch}`);
        if (
          removeResult.output.includes("contains modified or untracked files")
        ) {
          console.error(
            "  Worktree has uncommitted changes. Use 'wt prune --force' to remove anyway.",
          );
        } else {
          console.error(`  ${removeResult.output.trim()}`);
        }
        failed++;
        continue;
      }
      git(["branch", "-d", wt.branch]);
      pruned++;
    }
  }

  if (pruned === 0 && failed === 0) {
    console.log("No merged worktrees to prune.");
  } else {
    if (pruned > 0) console.log(`Pruned ${pruned} worktree(s).`);
    if (failed > 0) console.log(`Failed to prune ${failed} worktree(s).`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(`Worktree manager

Usage: wt [--agent <agent>] <command>

Global options:
  --agent <agent>        Agent to launch: opencode (default), pi, amp

Commands:
  new [prompt]           Create new worktree with agent session
  scratch [--code]       Create worktree with timestamped name
                         (opens agent by default, --code for VS Code)
  prune [--force]        Remove worktrees for branches merged into main
`);
}

function parseAgent(args: string[]): { agent: Agent; rest: string[] } {
  const agentIndex = args.indexOf("--agent");
  if (agentIndex === -1) {
    return { agent: "opencode", rest: args };
  }

  const agentValue = args[agentIndex + 1];
  if (!agentValue || agentValue.startsWith("-")) {
    console.error("Error: --agent requires a value.");
    console.error(`  Valid agents: ${VALID_AGENTS.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_AGENTS.includes(agentValue as Agent)) {
    console.error(`Error: unknown agent "${agentValue}".`);
    console.error(`  Valid agents: ${VALID_AGENTS.join(", ")}`);
    process.exit(1);
  }

  const rest = [...args.slice(0, agentIndex), ...args.slice(agentIndex + 2)];
  return { agent: agentValue as Agent, rest };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { agent, rest } = parseAgent(rawArgs);

  const command = rest[0];
  const commandArgs = rest.slice(1);

  switch (command) {
    case "new":
      await newWorktree(agent, commandArgs[0]);
      break;
    case "scratch": {
      const useCode = commandArgs.includes("--code");
      await scratchWorktree(agent, useCode);
      break;
    }
    case "prune": {
      const force =
        commandArgs.includes("--force") || commandArgs.includes("-f");
      await pruneWorktrees(force);
      break;
    }
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      showHelp();
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
