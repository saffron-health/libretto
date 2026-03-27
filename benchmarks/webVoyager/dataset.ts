import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type WebVoyagerRow = {
  id: string;
  web: string;
  ques: string;
  web_name?: string;
};

export type WebVoyagerSelection = {
  mode: "slice" | "random";
  offset: number;
  count: number | null;
  seed: number | null;
  totalCaseCount: number;
  selectedCaseCount: number;
  rows: WebVoyagerRow[];
};

const DEFAULT_RANDOM_SEED = 1;
const webVoyagerCasesPath = resolve(import.meta.dirname, "cases.jsonl");

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

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function getWebVoyagerCasesPath(): string {
  return webVoyagerCasesPath;
}

export function parseWebVoyagerRows(jsonl: string): WebVoyagerRow[] {
  const lines = jsonl
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

export function readWebVoyagerRows(
  filePath: string = getWebVoyagerCasesPath(),
): WebVoyagerRow[] {
  return parseWebVoyagerRows(readFileSync(filePath, "utf8"));
}

export function selectWebVoyagerRows(
  rows: WebVoyagerRow[],
  options: {
    offset?: number;
    count?: number;
    seed?: number;
    random?: boolean;
  },
): WebVoyagerSelection {
  const totalCaseCount = rows.length;
  const offset = options.offset ?? 0;
  const count = options.count ?? null;
  const seed = options.seed ?? DEFAULT_RANDOM_SEED;
  const mode = options.random ? "random" : "slice";

  if (totalCaseCount === 0) {
    throw new Error("WebVoyager cases.jsonl is empty.");
  }

  if (offset < 0) {
    throw new Error(`--offset must be non-negative. Received: ${offset}`);
  }

  if (count != null && count <= 0) {
    throw new Error(`--count must be positive. Received: ${count}`);
  }

  if (mode === "random") {
    const sampleCount = count ?? totalCaseCount;
    if (sampleCount > totalCaseCount) {
      throw new Error(
        `Cannot randomly select ${sampleCount} case(s) from ${totalCaseCount} available WebVoyager cases.`,
      );
    }

    const selectedRows = shuffleRows(rows, seed).slice(0, sampleCount);
    return {
      mode,
      offset: 0,
      count: sampleCount,
      seed,
      totalCaseCount,
      selectedCaseCount: selectedRows.length,
      rows: selectedRows,
    };
  }

  if (offset >= totalCaseCount) {
    throw new Error(
      `--offset ${offset} is out of range for ${totalCaseCount} WebVoyager cases.`,
    );
  }

  const selectedRows = rows.slice(offset, count == null ? undefined : offset + count);
  return {
    mode,
    offset,
    count,
    seed: null,
    totalCaseCount,
    selectedCaseCount: selectedRows.length,
    rows: selectedRows,
  };
}

export function formatSelectionSummary(selection: WebVoyagerSelection): string {
  if (selection.mode === "random") {
    return `random sample of ${selection.selectedCaseCount} case(s) from ${selection.totalCaseCount} total (seed ${selection.seed ?? DEFAULT_RANDOM_SEED})`;
  }

  if (selection.count == null) {
    return `slice from offset ${selection.offset} through the remaining ${selection.selectedCaseCount} case(s) of ${selection.totalCaseCount}`;
  }

  return `slice of ${selection.selectedCaseCount} case(s) from offset ${selection.offset} (requested count ${selection.count}) out of ${selection.totalCaseCount}`;
}
