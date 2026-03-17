import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatBenchmarkSessionName,
  getBenchmarkCliCommandPrefix,
  type BrowserBenchmarkCase,
} from "../shared/cases.js";

type WebVoyagerRow = {
  id: string;
  web: string;
  ques: string;
  web_name?: string;
};

function parseBooleanEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(
    `${name} must be one of: 1, 0, true, false, yes, no, on, off. Received: ${raw}`,
  );
}

function parseSeed(): number {
  const raw = process.env.LIBRETTO_WEBVOYAGER_RANDOM_SEED?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `LIBRETTO_WEBVOYAGER_RANDOM_SEED must be a number. Received: ${raw}`,
    );
  }
  return Math.floor(parsed);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRows(rows: WebVoyagerRow[], seed: number): WebVoyagerRow[] {
  const random = createSeededRandom(seed);
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const datasetPath = resolve(
  import.meta.dirname,
  "data",
  "WebVoyager_data.jsonl",
);

function parseLimit(totalRows: number): number {
  const raw = process.env.LIBRETTO_WEBVOYAGER_LIMIT?.trim();
  if (!raw) return totalRows;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `LIBRETTO_WEBVOYAGER_LIMIT must be a positive number. Received: ${raw}`,
    );
  }
  return Math.floor(parsed);
}

function parseOffset(): number {
  const raw = process.env.LIBRETTO_WEBVOYAGER_OFFSET?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `LIBRETTO_WEBVOYAGER_OFFSET must be a non-negative number. Received: ${raw}`,
    );
  }
  return Math.floor(parsed);
}

function readDatasetRows(): WebVoyagerRow[] {
  const lines = readFileSync(datasetPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parsed = JSON.parse(line) as Partial<WebVoyagerRow>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.web !== "string" ||
      typeof parsed.ques !== "string"
    ) {
      throw new Error(`Invalid WebVoyager row: ${line}`);
    }
    return {
      id: parsed.id,
      web: parsed.web,
      ques: parsed.ques,
      web_name: typeof parsed.web_name === "string" ? parsed.web_name : undefined,
    };
  });
}

export function getWebVoyagerCases(): BrowserBenchmarkCase[] {
  const cli = getBenchmarkCliCommandPrefix();
  const rows = readDatasetRows();
  const sampledRows = parseBooleanEnv("LIBRETTO_WEBVOYAGER_RANDOM_SAMPLE")
    ? shuffleRows(rows, parseSeed())
    : rows;
  const offset = parseOffset();
  const limit = parseLimit(sampledRows.length);

  return sampledRows.slice(offset, offset + limit).map((row) => {
    const sessionName = formatBenchmarkSessionName("webVoyager", row.id);
    return {
      benchmark: "webVoyager",
      id: row.id,
      title: `${row.web_name ?? row.web}: ${row.ques}`,
      startUrl: row.web,
      instruction: row.ques,
      finalResultInstruction:
        'End with exactly one line in this format: FINAL_RESULT: <answer> | <url> | <title>',
      requiredTranscriptSnippets: [
        `${cli} open ${row.web} --headless --session ${sessionName}`,
        "FINAL_RESULT:",
      ],
      successAssertion: [
        `Evaluate whether the transcript shows successful completion of this WebVoyager task: "${row.ques}"`,
        "Success requires that the agent uses the Libretto CLI to browse the live target website, reaches a relevant page state, and provides a concrete final answer that satisfies the task.",
        "Minor wording differences are acceptable, but the final answer must materially answer the task rather than only restate navigation steps or page titles.",
        "Fail the task if the answer is missing, unsupported by the browsing transcript, obviously incomplete, or clearly inconsistent with the observed page state.",
      ].join(" "),
    };
  });
}
