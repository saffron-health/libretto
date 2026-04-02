import type { WebVoyagerRow } from "./dataset.js";

const BENCHMARK_NAME = "webVoyager";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function formatSessionName(caseId: string): string {
  return slugify(`${BENCHMARK_NAME}-${caseId}`);
}

export function getRunName(row: WebVoyagerRow): string {
  const siteSlug = slugify(row.web_name ?? new URL(row.web).hostname);
  return slugify(`${siteSlug}-${row.id}`);
}

export type WebVoyagerPrompt = {
  text: string;
  sessionName: string;
};

export function buildWebVoyagerPrompt(row: WebVoyagerRow): WebVoyagerPrompt {
  const sessionName = formatSessionName(row.id);

  const text = `${row.ques} Starting website: ${row.web}. Use the libretto skill, with session name "${sessionName}".`;

  return { text, sessionName };
}
