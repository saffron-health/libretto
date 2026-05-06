import type {
  EvalJudgeRecord,
  EvalScoreMetadata,
  ScoredCriterion,
  TranscriptScore,
} from "./harness.js";
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
  } | null;
  judge: EvalJudgeRecord | null;
};

const recordedScores: EvalScoreRecord[] = [];

function hasScoreMetadata(
  score: TranscriptScore,
): score is TranscriptScore & EvalScoreMetadata {
  return "agent" in score && "judge" in score;
}

function toRecord(name: string, score: TranscriptScore): EvalScoreRecord {
  const metadata = hasScoreMetadata(score) ? score : null;
  return {
    name,
    passed: score.passed,
    total: score.total,
    percent: score.percent,
    criteria: score.criteria,
    failures: score.criteria
      .filter((criterion) => !criterion.pass)
      .map(({ criterion, reason }) => ({ criterion, reason })),
    agent: metadata?.agent ?? null,
    judge: metadata?.judge ?? null,
  };
}

export function recordScore(name: string, score: TranscriptScore): EvalScoreRecord {
  const record = toRecord(name, score);
  recordedScores.push(record);
  return record;
}

export function takeRecordedScores(): EvalScoreRecord[] {
  return recordedScores.splice(0, recordedScores.length);
}
