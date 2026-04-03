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

  const text = [
    row.ques,
    `Use the libretto skill, with session name "${sessionName}".`,
    `The browser session is already open and connected to ${row.web}.`,
    `Do NOT run \`open\` — the session is pre-opened for you.`,
    `Start by taking a snapshot to see the current page state.`,
    `If you encounter a CAPTCHA or similar challenge, just wait — it will be solved automatically by the browser.`,
  ].join(" ");

  return { text, sessionName };
}
