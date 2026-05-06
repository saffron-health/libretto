import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoredCriterion, TranscriptScore } from "./harness.js";

type EvalFailureRecord = Pick<ScoredCriterion, "criterion" | "reason">;

export type EvalScoreRecord = {
  name: string;
  passed: number;
  total: number;
  percent: number;
  failures: EvalFailureRecord[];
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
    failures: score.criteria
      .filter((criterion) => !criterion.pass)
      .map(({ criterion, reason }) => ({ criterion, reason })),
  };
}

export function recordScore(name: string, score: TranscriptScore): EvalScoreRecord {
  const record = toRecord(name, score);
  const scoreDir = getScoreDir();
  if (!scoreDir) return record;

  mkdirSync(scoreDir, { recursive: true });

  const stableId = createHash("sha256")
    .update(`${name}:${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16);

  writeFileSync(
    join(scoreDir, `${stableId}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );

  return record;
}
