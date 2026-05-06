#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  getEvalCases,
  withEvalFileRegistration,
  type EvalCaseRecord,
} from "./eval-case.js";
import { createEvalContext } from "./fixtures.js";
import { takeRecordedScores, type EvalScoreRecord } from "./scoring.js";
import {
  evalAuthProfilePath,
  hasEvalAuthProfile,
  loginAuthProfile,
  missingAuthProfileMessage,
  normalizeAuthProfileDomain,
} from "./auth-profiles.js";

type RunCliOptions = {
  command: "run";
  outputDir: string;
  fileFilters: string[];
  testNamePattern: string | null;
};

type ProfilesStatusCliOptions = {
  command: "profiles-status";
};

type ProfilesLoginCliOptions = {
  command: "profiles-login";
  domain: string;
};

type CliOptions =
  | RunCliOptions
  | ProfilesStatusCliOptions
  | ProfilesLoginCliOptions;

type CaseResult = {
  id: string;
  name: string;
  file: string | null;
  status: "completed" | "error" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scores: EvalScoreRecord[];
  error?: string;
  skipReason?: string;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const evalsRoot = resolve(here);
const repoRoot = resolve(evalsRoot, "..");

function usage(): string {
  return [
    "Usage:",
    "  pnpm evals [run] [file-filter ...] [-t <pattern>] [--output <dir>]",
    "  pnpm evals profiles status",
    "  pnpm evals profiles login <domain>",
    "",
    "Examples:",
    "  pnpm evals",
    "  pnpm evals run -t network",
    "  pnpm evals basic.eval.ts --output temp/eval-run",
    "  pnpm evals profiles status",
    "  pnpm evals profiles login linkedin.com",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const first = args[0];
  if (first === "--help" || first === "-h") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (first === "run") {
    args.shift();
  } else if (first === "profiles") {
    args.shift();
    const subcommand = args.shift();
    if (subcommand === "status") {
      if (args.length > 0) {
        throw new Error("profiles status does not accept extra arguments.");
      }
      return { command: "profiles-status" };
    }
    if (subcommand === "login") {
      const domain = args.shift();
      if (!domain || args.length > 0) {
        throw new Error("Usage: pnpm evals profiles login <domain>");
      }
      return {
        command: "profiles-login",
        domain: normalizeAuthProfileDomain(domain),
      };
    }
    throw new Error("Expected profiles subcommand: status or login.");
  }

  let outputDir: string | null = null;
  let testNamePattern: string | null = null;
  const fileFilters: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) throw new Error("--output requires a directory.");
      outputDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputDir = arg.slice("--output=".length);
      if (!outputDir) throw new Error("--output requires a directory.");
      continue;
    }
    if (arg === "-t" || arg === "--testNamePattern") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a pattern.`);
      testNamePattern = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--testNamePattern=")) {
      testNamePattern = arg.slice("--testNamePattern=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    fileFilters.push(arg);
  }

  return {
    command: "run",
    outputDir: resolve(
      repoRoot,
      outputDir ?? join("evals", "runs", createRunId()),
    ),
    fileFilters,
    testNamePattern,
  };
}

function createRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(".", "-");
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function matchesFileFilters(filePath: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const absolute = toPosixPath(filePath);
  const relativePath = toPosixPath(relative(evalsRoot, filePath));
  return filters.some((filter) => {
    const resolved = isAbsolute(filter) ? filter : resolve(repoRoot, filter);
    const normalizedFilter = toPosixPath(filter);
    return (
      absolute.includes(toPosixPath(resolved)) ||
      relativePath.includes(normalizedFilter) ||
      absolute.includes(normalizedFilter)
    );
  });
}

async function collectEvalFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  const ignoredTopLevelDirs = new Set([
    "node_modules",
    "private",
    "profiles",
    "runs",
  ]);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const relativePath = toPosixPath(relative(evalsRoot, path));
    if (entry.isDirectory()) {
      const topLevelDir = relativePath.split("/", 1)[0];
      if (ignoredTopLevelDirs.has(topLevelDir)) {
        continue;
      }
      files.push(...(await collectEvalFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".eval.ts")) {
      files.push(path);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function discoverEvalFiles(fileFilters: string[]): Promise<string[]> {
  const files = await collectEvalFiles(evalsRoot);
  return files.filter((file) => matchesFileFilters(file, fileFilters));
}

async function importEvalFiles(files: string[]): Promise<EvalCaseRecord[]> {
  for (const file of files) {
    await withEvalFileRegistration(file, async () => {
      await import(pathToFileURL(file).href);
    });
  }
  return getEvalCases();
}

function filterByName(
  cases: EvalCaseRecord[],
  testNamePattern: string | null,
): EvalCaseRecord[] {
  if (!testNamePattern) return cases;
  const pattern = new RegExp(testNamePattern, "i");
  return cases.filter((evalCase) => pattern.test(evalCase.name));
}

function selectCases(
  cases: EvalCaseRecord[],
  testNamePattern: string | null,
): EvalCaseRecord[] {
  const nameFiltered = filterByName(cases, testNamePattern);
  const onlyCases = nameFiltered.filter((evalCase) => evalCase.only);
  return onlyCases.length > 0 ? onlyCases : nameFiltered;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function caseIds(cases: EvalCaseRecord[]): Map<EvalCaseRecord, string> {
  const counts = new Map<string, number>();
  const ids = new Map<EvalCaseRecord, string>();
  for (const evalCase of cases) {
    const base = slugify(evalCase.name);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.set(evalCase, count === 0 ? base : `${base}-${count + 1}`);
  }
  return ids;
}

function casesByRequiredProfile(
  cases: EvalCaseRecord[],
): Map<string, EvalCaseRecord[]> {
  const byDomain = new Map<string, EvalCaseRecord[]>();
  for (const evalCase of cases) {
    if (!evalCase.authProfile) continue;
    const casesForDomain = byDomain.get(evalCase.authProfile) ?? [];
    casesForDomain.push(evalCase);
    byDomain.set(evalCase.authProfile, casesForDomain);
  }
  return byDomain;
}

function preflightRequiredProfiles(cases: EvalCaseRecord[]): void {
  const missing = Array.from(casesByRequiredProfile(cases).keys()).filter(
    (domain) => !hasEvalAuthProfile(domain),
  );
  if (missing.length === 0) return;

  throw new Error(missing.map(missingAuthProfileMessage).join("\n\n"));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCase(
  evalCase: EvalCaseRecord,
  id: string,
  outputDir: string,
): Promise<CaseResult> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const caseDir = join(outputDir, "cases", id);
  const previousScoreDir = process.env.LIBRETTO_EVAL_SCORE_DIR;
  const previousTranscriptPath = process.env.LIBRETTO_EVAL_TRANSCRIPT_PATH;
  process.env.LIBRETTO_EVAL_SCORE_DIR = join(caseDir, "scores");
  process.env.LIBRETTO_EVAL_TRANSCRIPT_PATH = join(caseDir, "transcript.jsonl");
  takeRecordedScores();

  let status: CaseResult["status"] = "completed";
  let errorMessage: string | undefined;
  let cleanupErrorMessage: string | undefined;
  let context: Awaited<ReturnType<typeof createEvalContext>> | null = null;
  try {
    context = await createEvalContext(evalCase);
    await evalCase.run(context);
  } catch (error) {
    status = "error";
    errorMessage = formatError(error);
  } finally {
    try {
      await context?.dispose();
    } catch (error) {
      status = "error";
      cleanupErrorMessage = `Cleanup failed:\n${formatError(error)}`;
    } finally {
      if (previousScoreDir === undefined) {
        delete process.env.LIBRETTO_EVAL_SCORE_DIR;
      } else {
        process.env.LIBRETTO_EVAL_SCORE_DIR = previousScoreDir;
      }
      if (previousTranscriptPath === undefined) {
        delete process.env.LIBRETTO_EVAL_TRANSCRIPT_PATH;
      } else {
        process.env.LIBRETTO_EVAL_TRANSCRIPT_PATH = previousTranscriptPath;
      }
    }
  }

  const finishedMs = Date.now();
  const combinedError = [errorMessage, cleanupErrorMessage]
    .filter((message) => message && message.length > 0)
    .join("\n\n");
  const result: CaseResult = {
    id,
    name: evalCase.name,
    file: evalCase.filePath ? relative(repoRoot, evalCase.filePath) : null,
    status,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    scores: takeRecordedScores(),
    ...(combinedError ? { error: combinedError } : {}),
  };
  await writeJson(join(caseDir, "result.json"), result);
  return result;
}

async function run(options: CliOptions): Promise<number> {
  if (options.command === "profiles-status") {
    return await profilesStatus();
  }
  if (options.command === "profiles-login") {
    await loginAuthProfile(options.domain);
    return 0;
  }

  const startedAt = new Date().toISOString();
  const files = await discoverEvalFiles(options.fileFilters);
  if (files.length === 0) {
    throw new Error("No eval files matched the provided filters.");
  }

  const registeredCases = await importEvalFiles(files);
  const selectedCases = selectCases(registeredCases, options.testNamePattern);
  if (selectedCases.length === 0) {
    throw new Error("No eval cases matched the provided filters.");
  }
  preflightRequiredProfiles(selectedCases);

  await mkdir(options.outputDir, { recursive: true });
  process.stdout.write(`Running ${selectedCases.length} eval case(s)\n`);
  process.stdout.write(`Output: ${options.outputDir}\n`);

  const ids = caseIds(selectedCases);
  const results: CaseResult[] = [];
  for (const evalCase of selectedCases) {
    const id = ids.get(evalCase);
    if (!id) {
      throw new Error(`Failed to allocate result ID for ${evalCase.name}`);
    }
    process.stdout.write(`\n▶ ${evalCase.name}\n`);
    const result = await runCase(evalCase, id, options.outputDir);
    results.push(result);
    if (result.status === "completed") {
      process.stdout.write(`✓ ${evalCase.name}\n`);
    } else if (result.status === "skipped") {
      process.stdout.write(
        `- ${evalCase.name} skipped: ${result.skipReason ?? "No reason provided."}\n`,
      );
    } else {
      process.stdout.write(`✗ ${evalCase.name}\n${result.error ?? "Unknown error"}\n`);
    }
  }

  const completed = results.filter(
    (result) => result.status === "completed",
  ).length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const errored = results.filter((result) => result.status === "error").length;
  const scorePassed = results.reduce(
    (total, result) =>
      total + result.scores.reduce((sum, score) => sum + score.passed, 0),
    0,
  );
  const scoreTotal = results.reduce(
    (total, result) =>
      total + result.scores.reduce((sum, score) => sum + score.total, 0),
    0,
  );
  const runRecord = {
    command: options.command,
    startedAt,
    finishedAt: new Date().toISOString(),
    outputDir: options.outputDir,
    fileFilters: options.fileFilters,
    testNamePattern: options.testNamePattern,
    selectedModel: process.env.LIBRETTO_EVAL_MODEL?.trim() || "openai/gpt-5.5",
    totals: {
      cases: results.length,
      completed,
      skipped,
      errored,
      scorePassed,
      scoreTotal,
    },
    cases: results,
  };

  await writeJson(join(options.outputDir, "run.json"), runRecord);
  await writeJson(join(options.outputDir, "summary.json"), runRecord.totals);

  process.stdout.write(
    `\nCompleted ${completed}/${results.length} eval case(s); score ${scorePassed}/${scoreTotal}; ${skipped} skipped; ${errored} error(s).\n`,
  );
  return errored > 0 ? 1 : 0;
}

async function profilesStatus(): Promise<number> {
  const files = await discoverEvalFiles([]);
  if (files.length === 0) {
    throw new Error("No eval files found.");
  }

  const registeredCases = await importEvalFiles(files);
  const byDomain = casesByRequiredProfile(registeredCases);
  if (byDomain.size === 0) {
    process.stdout.write(
      "No auth profiles are required by discovered eval cases.\n",
    );
    return 0;
  }

  process.stdout.write("Eval auth profiles:\n");
  for (const [domain, cases] of Array.from(byDomain.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const profilePath = evalAuthProfilePath(domain);
    const exists = hasEvalAuthProfile(domain);
    process.stdout.write(`\n${domain}\n`);
    process.stdout.write(`  Status: ${exists ? "present" : "missing"}\n`);
    process.stdout.write(`  Profile: ${profilePath}\n`);
    process.stdout.write("  Required by:\n");
    for (const evalCase of cases) {
      const file = evalCase.filePath
        ? relative(repoRoot, evalCase.filePath)
        : "unknown file";
      process.stdout.write(`    - ${evalCase.name} (${file})\n`);
    }
    process.stdout.write(
      `  Create/refresh: pnpm evals profiles login ${domain}\n`,
    );
  }
  return 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  process.exitCode = await run(options);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}
