import { AsyncLocalStorage } from "node:async_hooks";
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
const callStorage = new AsyncLocalStorage<EvalCallRecord[]>();

function currentRecordedCalls(): EvalCallRecord[] {
  return callStorage.getStore() ?? recordedCalls;
}

export function recordEvalCall(record: EvalCallRecord): void {
  currentRecordedCalls().push(record);
}

export function takeRecordedEvalCalls(): EvalCallRecord[] {
  const calls = currentRecordedCalls();
  return calls.splice(0, calls.length);
}

export async function withEvalCallRecording<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return await callStorage.run([], fn);
}
