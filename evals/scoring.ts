import type { EvalJudgeRecord, EvalScore, ScoredCriterion } from "./harness.js";
import type { EvalMetrics } from "./artifacts.js";

type EvalFailureRecord = Pick<ScoredCriterion, "criterion" | "reason">;

export type EvalScoreRecord = {
  name: string;
  passed: number;
  total: number;
  percent: number;
  criteria: ScoredCriterion[];
  failures: EvalFailureRecord[];
  agent: {
    prompt: string;
    model: string;
    sessionId: string;
    metrics: EvalMetrics;
  };
  judge: EvalJudgeRecord;
};

const recordedScores: EvalScoreRecord[] = [];

function toRecord(name: string, score: EvalScore): EvalScoreRecord {
  return {
    name,
    passed: score.passed,
    total: score.total,
    percent: score.percent,
    criteria: score.criteria,
    failures: score.criteria
      .filter((criterion) => !criterion.pass)
      .map(({ criterion, reason }) => ({ criterion, reason })),
    agent: score.agent,
    judge: score.judge,
  };
}

export function recordScore(name: string, score: EvalScore): EvalScoreRecord {
  const record = toRecord(name, score);
  recordedScores.push(record);
  return record;
}

export function takeRecordedScores(): EvalScoreRecord[] {
  return recordedScores.splice(0, recordedScores.length);
}
