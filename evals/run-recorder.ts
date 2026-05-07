import type { EvalMetrics } from "./artifacts.js";

export type EvalCallRecord = {
  source: "agent" | "judge";
  prompt: string;
  model: string;
  sessionId: string | null;
  metrics: EvalMetrics;
  error: string | null;
};

const recordedCalls: EvalCallRecord[] = [];

export function recordEvalCall(record: EvalCallRecord): void {
  recordedCalls.push(record);
}

export function takeRecordedEvalCalls(): EvalCallRecord[] {
  return recordedCalls.splice(0, recordedCalls.length);
}
