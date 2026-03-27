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

function formatCaseLabel(row: WebVoyagerRow): string {
  return `${row.id}: ${row.web_name ?? row.web}: ${row.ques}`;
}

export function getRunName(row: WebVoyagerRow): string {
  const siteSlug = slugify(row.web_name ?? new URL(row.web).hostname);
  return slugify(`${siteSlug}-${row.id}`);
}

export function rewriteBenchmarkSkillCommands(markdown: string): string {
  return markdown.replaceAll("npx libretto", "pnpm -s cli");
}

export function buildWebVoyagerPrompt(row: WebVoyagerRow, runDir: string): string {
  const sessionName = formatSessionName(row.id);

  return [
    `Run the ${BENCHMARK_NAME} benchmark case \"${formatCaseLabel(row)}\".`,
    `Current working directory: ${runDir}`,
    "Use the libretto skill available in this workspace.",
    "Use the local Libretto CLI via `pnpm -s cli ...`.",
    `Use exactly one Libretto session named \"${sessionName}\".`,
    `Open the site with: pnpm -s cli open ${row.web} --headless --session ${sessionName}`,
    `Before finishing, run: pnpm -s cli exec --session ${sessionName} \"return { url: await page.url(), title: await page.title() }\"`,
    `Then close the browser with: pnpm -s cli close --session ${sessionName}`,
    "Do not inspect sibling benchmark files or parent benchmark directories to discover the answer.",
    "Your final message should directly answer the task. If you are blocked, explain the blocker clearly in the final message.",
    "",
    "Task:",
    row.ques,
  ].join("\n");
}
