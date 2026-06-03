import { spawn } from "node:child_process";
import { appendFile, cp, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { evalCase } from "./eval-case.js";
import type { EvalAgentName } from "./agents.js";
import { scoreTranscript, type EvalScore } from "./harness.js";
import { getEvalArtifactPaths, type EvalMetrics } from "./artifacts.js";
import { recordEvalCall } from "./run-recorder.js";
import { recordScore, type InfraClassification } from "./scoring.js";

export type WebsiteEval = {
  name: string;
  task: string;
};

export const WEBSITE_EVALS: WebsiteEval[] = [
  {
    name: "craigslist used bikes search",
    task: "Search Craigslist for used bikes in San Francisco. Tell me the title and price of the first relevant listing.",
  },
  {
    name: "apartments.com austin apartment search",
    task: "Search Apartments.com for apartments in Austin under $2,000. Tell me the first listing name, price, and neighborhood.",
  },
  {
    name: "apple newest iphone lookup",
    task: "Find the newest iPhone on Apple.com. Tell me its starting price and available colors.",
  },
  {
    name: "google official playwright docs result",
    task: 'Search Google for "Playwright docs network mocking". Open the official docs result and tell me the page title.',
  },
  {
    name: "youtube playwright tutorial search",
    task: 'Search YouTube for "Playwright tutorial". Tell me the title of the first video result.',
  },
  {
    name: "reddit browser automation thread",
    task: 'Search Reddit for "browser automation". Open one relevant thread and summarize the top comment.',
  },
  {
    name: "amazon wireless mouse search",
    task: 'Search Amazon for "wireless mouse". Tell me the name and price of the first organic result.',
  },
  {
    name: "walmart paper towels search",
    task: 'Search Walmart for "paper towels". Tell me the first product name, price, and whether pickup is available.',
  },
  {
    name: "target coffee maker search",
    task: 'Search Target for "coffee maker". Tell me the first product name, price, and rating.',
  },
  {
    name: "best buy headphones search",
    task: 'Search Best Buy for "noise cancelling headphones". Tell me the first product name and price.',
  },
  {
    name: "airbnb austin next weekend search",
    task: "Search Airbnb for stays in Austin next weekend. Tell me the first listing name and nightly price.",
  },
  {
    name: "booking.com chicago hotel search",
    task: "Search Booking.com for hotels in Chicago next weekend. Tell me the first hotel name, rating, and price.",
  },
  {
    name: "expedia sfo jfk flight search",
    task: "Search Expedia for flights from SFO to JFK next Friday. Tell me the cheapest listed price.",
  },
  {
    name: "doordash nyc pizza search",
    task: "Search DoorDash for pizza near New York City. Tell me the first restaurant name and rating.",
  },
  {
    name: "uber eats sf sushi search",
    task: "Search Uber Eats for sushi near San Francisco. Tell me the first restaurant name and delivery estimate.",
  },
  {
    name: "zillow seattle homes search",
    task: "Search Zillow for homes in Seattle under $800k. Tell me the first listing price and address area.",
  },
  {
    name: "realtor.com denver homes search",
    task: "Search Realtor.com for homes in Denver. Tell me the first listing price and number of bedrooms.",
  },
  {
    name: "yelp brooklyn coffee shops search",
    task: "Search Yelp for coffee shops in Brooklyn. Tell me the first business name, rating, and review count.",
  },
  {
    name: "linkedin public job search",
    task: 'Search LinkedIn for "browser automation engineer". Tell me if public results are visible without signing in.',
  },
  {
    name: "hacker news browser automation search",
    task: 'Search Hacker News for "browser automation". Find one recent thread and tell me its title.',
  },
  {
    name: "github playwright repo stats",
    task: "Open the Playwright GitHub repo. Tell me how many stars it has and what language it mostly uses.",
  },
  {
    name: "npm playwright package lookup",
    task: "Look up the playwright package on npm. Tell me the latest version and weekly downloads.",
  },
  {
    name: "pypi requests package lookup",
    task: "Look up the requests package on PyPI. Tell me the latest version and supported Python versions.",
  },
  {
    name: "mdn array map lookup",
    task: "Find the MDN page for Array.prototype.map(). Tell me what the method returns.",
  },
  {
    name: "wikipedia olympics medal table lookup",
    task: "Open the Wikipedia page for the 2024 Summer Olympics medal table. Tell me the top three countries.",
  },
  {
    name: "books to scrape five star cheapest book",
    task: "Find the cheapest book with a 5-star rating on Books to Scrape. Tell me its title and price.",
  },
  {
    name: "quotes to scrape einstein quote",
    task: "Go through Quotes to Scrape and find the first quote by Albert Einstein. Tell me the quote.",
  },
];

export const ANTI_BOT_CLEAN_WEBSITE_EVAL_NAMES = new Set([
  "airbnb austin next weekend search",
  "amazon wireless mouse search",
  "apple newest iphone lookup",
  "best buy headphones search",
  "craigslist used bikes search",
  "github playwright repo stats",
  "hacker news browser automation search",
  "linkedin public job search",
  "mdn array map lookup",
  "pypi requests package lookup",
  "quotes to scrape einstein quote",
  "target coffee maker search",
  "uber eats sf sushi search",
  "wikipedia olympics medal table lookup",
  "youtube playwright tutorial search",
]);

const LIVE_PAGE_EVIDENCE_CRITERION =
  "The agent used the selected browser automation agent to reach the requested website or task area, perform the requested search or lookup, and return a plausible answer grounded in live page evidence. Be lenient about ambiguous result choice, sorting, availability, prices, or dynamic website content. Mark false if the run used the wrong website or task area, could not access the relevant page due to browser/provider issues, or returned an answer without evidence from the live page.";
const ANTI_BOT_CRITERION =
  "Mark false if the run encountered or reported an anti-bot block, including CAPTCHA, challenge, human verification, bot check, Access Denied, permission denied, blocked, 403/Forbidden, unusual traffic, or bot-detection pages, and the block was still present after the agent waited up to 3 minutes and checked the same intended site again. Mark false if the agent worked around an anti-bot block by opening another page, session, search result, mirror, API, cached copy, or fallback source. Mark true for a challenge if the configured browser provider visibly solved it automatically within the 3-minute wait and the agent continued directly on the intended site from that solved page.";

function infraClassificationForScore(
  score: EvalScore,
): InfraClassification {
  const antiBotCriterion = score.criteria[1];
  if (antiBotCriterion && !antiBotCriterion.pass) return "anti-bot-failure";
  return score.passed === score.total ? "clean-pass" : "ordinary-failure";
}

function agentInstruction(agentName: EvalAgentName, browserProvider: string): string {
  if (agentName === "browser-use") {
    return [
      "Use Browser Use with the configured browser provider.",
      "If you hit a CAPTCHA, bot check, access-denied page, or similar anti-bot block, call solve_captcha once, then continue if the page is solved or report blocked if it remains.",
    ].join(" ");
  }

  return [
    "Use Libretto with the configured browser provider.",
    "When creating the workflow, first try to use captured network requests or browser-session fetches for the core data retrieval, and fall back to DOM automation only if that is not practical.",
    "If you hit a CAPTCHA, bot check, access-denied page, or similar anti-bot block, call solve_captcha once, then continue if the page is solved or report blocked if it remains.",
  ].join(" ");
}

function zeroAiMetrics(durationMs: number, error: string | null): EvalMetrics {
  return {
    durationMs,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    turns: 0,
    turnsWithUsage: 0,
    toolCalls: {},
    totalToolCalls: 0,
    failedToolCalls: error ? 1 : 0,
    failedToolCallsByName: error ? { "libretto run": 1 } : {},
    model: null,
    provider: "libretto-cached",
    responseIds: [],
    stopReasons: [],
    sessionId: null,
    error,
    usageTurns: [],
  };
}

async function appendArtifact(path: string | undefined, text: string): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, text, "utf8");
}

async function copyGeneratedWorkflow(workflowPath: string): Promise<void> {
  const paths = getEvalArtifactPaths();
  if (!paths) return;
  const targetPath = join(dirname(paths.transcript), "generated-workflow.ts");
  await cp(workflowPath, targetPath, { force: true });
}

function generatedWorkflowForCachedRun(): string {
  const paths = getEvalArtifactPaths();
  if (!paths) {
    throw new Error("libretto-cached requires eval artifact paths.");
  }
  const caseDir = dirname(paths.transcript);
  const caseId = basename(caseDir);
  if (!caseId.endsWith("-libretto-cached")) {
    throw new Error(
      `libretto-cached case id must end with -libretto-cached. Received: ${caseId}`,
    );
  }
  const sourceCaseId = caseId.slice(0, -"-libretto-cached".length);
  return join(dirname(caseDir), sourceCaseId, "generated-workflow.ts");
}

async function runCommand(opts: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolvePromise({ stdout, stderr, exitCode, timedOut });
    });
  });
}

async function runCachedWorkflow(opts: {
  task: string;
  criteria: string[];
  cwd: string;
  workflowPath: string;
}): Promise<EvalScore> {
  const paths = getEvalArtifactPaths();
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const run = await runCommand({
    command: "pnpm",
    args: ["exec", "libretto", "run", opts.workflowPath, "--headless"],
    cwd: opts.cwd,
    timeoutMs: 5 * 60_000,
  });
  const durationMs = Date.now() - startedMs;
  const finishedAt = new Date(startedMs + durationMs).toISOString();
  const cleanupOnlyFailure =
    run.exitCode !== 0 &&
    run.stdout.includes("Integration completed.") &&
    /Failed to close session .*cleanup-failed/i.test(run.stderr);
  const error =
    run.timedOut || (run.exitCode !== 0 && !cleanupOnlyFailure)
      ? [
          run.timedOut ? "libretto run timed out." : `libretto run exited ${run.exitCode}.`,
          run.stderr.trim(),
        ]
          .filter(Boolean)
          .join("\n")
      : null;
  const transcript = [
    `TASK: ${opts.task}`,
    `COMMAND: pnpm exec libretto run ${opts.workflowPath} --headless`,
    `STARTED_AT: ${startedAt}`,
    `FINISHED_AT: ${finishedAt}`,
    `EXIT_CODE: ${String(run.exitCode)}`,
    `TIMED_OUT: ${String(run.timedOut)}`,
    "",
    "STDOUT:",
    run.stdout.trim(),
    "",
    "STDERR:",
    run.stderr.trim(),
  ].join("\n");
  await appendArtifact(
    paths?.transcript,
    `${JSON.stringify({
      timestamp: startedAt,
      source: "agent",
      event: {
        type: "libretto_cached_workflow_run",
        command: ["pnpm", "exec", "libretto", "run", opts.workflowPath, "--headless"],
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        stdout: run.stdout,
        stderr: run.stderr,
      },
    })}\n`,
  );
  await appendArtifact(
    paths?.transcriptMarkdown,
    [
      "## Cached workflow run",
      "",
      `- Started: ${startedAt}`,
      `- Finished: ${finishedAt}`,
      "",
      "### Transcript",
      "",
      "```text",
      transcript,
      "```",
      "",
    ].join("\n"),
  );
  await writeFile(join(dirname(opts.workflowPath), "cached-run-output.txt"), transcript);

  const metrics = zeroAiMetrics(durationMs, error);
  recordEvalCall({
    source: "agent",
    prompt: `Run cached Libretto workflow for task: ${opts.task}`,
    model: "libretto-cached",
    sessionId: null,
    metrics,
    error,
  });
  if (error) {
    throw new Error(error);
  }

  const score = await scoreTranscript({
    criteria: opts.criteria,
    cwd: opts.cwd,
    model: "openai/gpt-5.5",
  });
  return {
    ...score,
    agent: {
      prompt: `Run cached Libretto workflow for task: ${opts.task}`,
      model: "libretto-cached",
      sessionId: "",
      metrics,
    },
  };
}

export function registerWebsiteEvalCases(websiteEvals: WebsiteEval[]): void {
  for (const websiteEval of websiteEvals) {
    evalCase({ name: websiteEval.name }, async (context) => {
      const { agent } = context;
      const criteria = [LIVE_PAGE_EVIDENCE_CRITERION, ANTI_BOT_CRITERION];

      if (agent.name === "libretto-cached") {
        const sourceWorkflowPath = generatedWorkflowForCachedRun();
        const workflowPath = context.evalWorkspacePath("generated-workflow.ts");
        await cp(sourceWorkflowPath, workflowPath, { force: true });
        await copyGeneratedWorkflow(workflowPath);
        const score = await runCachedWorkflow({
          task: websiteEval.task,
          criteria,
          cwd: context.evalWorkspaceDir,
          workflowPath,
        });
        recordScore(websiteEval.name, score, {
          infraClassification: infraClassificationForScore(score),
        });
        return;
      }

      const workflowPath = context.evalWorkspacePath(
        `${websiteEval.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}.workflow.ts`,
      );
      const response = await agent.send(
        `${websiteEval.task}. ${agentInstruction(
          agent.name,
          agent.browserProvider,
        )} ${
          agent.name === "libretto"
            ? [
                `Create a reusable Libretto workflow file at ${workflowPath}.`,
                `Validate it by running \`pnpm exec libretto run ${workflowPath} --headless\`, then report the validated output.`,
              ].join(" ")
            : ""
        }`,
      );

      if (agent.name === "libretto") {
        await copyGeneratedWorkflow(workflowPath);
      }

      const score = await response.score(criteria);
      recordScore(websiteEval.name, score, {
        infraClassification: infraClassificationForScore(score),
      });
    });
  }
}
