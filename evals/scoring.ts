import { AsyncLocalStorage } from "node:async_hooks";
import type { EvalJudgeRecord, EvalScore, ScoredCriterion } from "./harness.js";
import type { EvalMetrics } from "./artifacts.js";

type EvalFailureRecord = Pick<ScoredCriterion, "criterion" | "reason">;

export type EvalInfraClassification =
  | "clean-pass"
  | "anti-bot-failure"
  | "system-failure"
  | "ordinary-failure";

export type EvalScoreMetadata = {
  infraClassification?: EvalInfraClassification;
};

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
  infraClassification?: EvalInfraClassification;
};

const recordedScores: EvalScoreRecord[] = [];
const scoreStorage = new AsyncLocalStorage<EvalScoreRecord[]>();

function currentRecordedScores(): EvalScoreRecord[] {
  return scoreStorage.getStore() ?? recordedScores;
}

function toRecord(
  name: string,
  score: EvalScore,
  metadata: EvalScoreMetadata = {},
): EvalScoreRecord {
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
    ...(metadata.infraClassification
      ? { infraClassification: metadata.infraClassification }
      : {}),
  };
}

export function recordScore(
  name: string,
  score: EvalScore,
  metadata: EvalScoreMetadata = {},
): EvalScoreRecord {
  const record = toRecord(name, score, metadata);
  currentRecordedScores().push(record);
  return record;
}

export function takeRecordedScores(): EvalScoreRecord[] {
  const scores = currentRecordedScores();
  return scores.splice(0, scores.length);
}

export async function withScoreRecording<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return await scoreStorage.run([], fn);
}
