import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptScore } from "./harness.js";

type EvalScoreRecord = {
  name: string;
  passed: number;
  total: number;
  percent: number;
};

function getScoreDir(): string | null {
  const value = process.env.LIBRETTO_EVAL_SCORE_DIR;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(name: string, score: TranscriptScore): EvalScoreRecord {
  return {
    name,
    passed: score.passed,
    total: score.total,
    percent: score.percent,
  };
}

export function recordScore(name: string, score: TranscriptScore): void {
  const scoreDir = getScoreDir();
  if (!scoreDir) return;

  mkdirSync(scoreDir, { recursive: true });

  const stableId = createHash("sha256")
    .update(`${name}:${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16);

  writeFileSync(
    join(scoreDir, `${stableId}.json`),
    `${JSON.stringify(toRecord(name, score), null, 2)}\n`,
    "utf8",
  );
}

export function assertPerfectScore(name: string, score: TranscriptScore): void {
  recordScore(name, score);

  const failures = score.criteria
    .filter((criterion) => !criterion.pass)
    .map((criterion) => `- ${criterion.criterion}: ${criterion.reason}`);

  if (score.percent === 100 && failures.length === 0) return;

  throw new Error(
    [
      `Expected 100% score, got ${score.percent}%.`,
      failures.length > 0 ? failures.join("\n") : "No failed criteria were returned.",
    ].join("\n"),
  );
}
