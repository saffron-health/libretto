import { describe } from "vitest";
import { expect, test } from "./fixtures.js";

type EvalScore = {
  percent: number;
  criteria: Array<{
    criterion: string;
    pass: boolean;
    reason: string;
  }>;
};

function assertPerfectScore(score: EvalScore): void {
  const failures = score.criteria
    .filter((criterion) => !criterion.pass)
    .map((criterion) => `- ${criterion.criterion}: ${criterion.reason}`);
  if (score.percent === 100 && failures.length === 0) return;
  throw new Error(
    [
      `Expected 100% score, got ${score.percent}%.`,
      failures.length > 0 ? failures.join("\n") : "No failed criteria were returned.",
    ].join("\n"),
  );
}

describe("basic eval scenarios", () => {
  test(
    "linkedin scrape generation and amendment",
    async ({ harness, evalWorkspaceDir, evalWorkspacePath, repoRoot }) => {
      const workflowPath = evalWorkspacePath("linkedin/linkedin-posts.mjs");

      const createResponse = await harness.send(
        [
          `You're in this workspace: ${evalWorkspaceDir}.`,
          `Please create a workflow at ${workflowPath}.`,
          "I want LinkedIn scraping for the first 10 posts with content, who posted, reaction count, first 25 comments, and first 25 reposts.",
          "Use `import { workflow } from \"libretto\"`.",
          `Run it once headless with auth profile linkedin.com using: pnpm --dir "${repoRoot}" --filter libretto cli -- run "${workflowPath}" scrapeLinkedInPosts --params '{"maxPosts":10,"maxComments":25,"maxReposts":25}' --headless --auth-profile linkedin.com`,
          "Tell me what happened.",
        ].join("\n\n"),
      );

      const createScore = await createResponse.score([
        "The assistant created the workflow file at the requested absolute path.",
        "The workflow targets first 10 LinkedIn posts and includes content, author, reaction count, first 25 comments, and first 25 reposts.",
        "The assistant attempted at least one headless run command with auth profile linkedin.com for this workflow.",
      ]);
      assertPerfectScore(createScore);

      const amendResponse = await harness.send(
        [
          `Now update ${workflowPath}.`,
          "Please include the tagline for each post author, and for the first 10 commenters click into their profiles and collect their taglines.",
          `Run it again with: pnpm --dir "${repoRoot}" --filter libretto cli -- run "${workflowPath}" scrapeLinkedInPosts --params '{"maxPosts":10,"maxComments":25,"maxReposts":25}' --headless --auth-profile linkedin.com`,
          "Give me a quick summary.",
        ].join("\n\n"),
      );

      const amendScore = await amendResponse.score([
        "The assistant amended the same workflow file.",
        "The updated workflow includes post author tagline extraction and commenter profile tagline extraction for the first 10 commenters.",
        "The assistant attempted at least one rerun command for the amended workflow.",
      ]);
      assertPerfectScore(amendScore);
    },
  );

  test(
    "broken selector debugging on a government website",
    async ({ harness, copyEvalReference, repoRoot }) => {
      const workflowPath = await copyEvalReference(
        "broken-selector/usa-gov-broken-selector.mjs",
        "scenarios/broken-selector/usa-gov-workflow.mjs",
      );

      const response = await harness.send(
        [
          `This workflow is broken: ${workflowPath}.`,
          "It's a government-site flow that should fill a search form and collect results.",
          "Can you run it, figure out what's failing, fix it in place, and rerun it so it works?",
          `Use this command to run: pnpm --dir "${repoRoot}" --filter libretto cli -- run "${workflowPath}" extractUsaGovTopic --headless --params '{"query":"passport renewal"}'`,
        ].join("\n\n"),
      );

      const score = await response.score([
        "The assistant attempted an initial run before editing and identified a failure.",
        "The assistant edited the workflow to fix the root cause.",
        "The assistant reran the workflow after the fix.",
        "The rerun produced success evidence with non-empty or meaningful search-result output.",
      ]);
      assertPerfectScore(score);
    },
  );

  test(
    "convert browser workflow to network requests",
    async ({ harness, copyEvalReference, repoRoot }) => {
      const workflowPath = await copyEvalReference(
        "network-conversion/weather-alerts-dom.mjs",
        "scenarios/network-conversion/weather-alerts.mjs",
      );

      const response = await harness.send(
        [
          `Can you convert this workflow to use network requests instead of DOM scraping? ${workflowPath}`,
          "Keep the same export name and output shape.",
          `After updating, run: pnpm --dir "${repoRoot}" --filter libretto cli -- run "${workflowPath}" collectWeatherAlertsFromDom --params '{"state":"CA","limit":5}' --headless`,
          "Share what you changed and what happened on run.",
        ].join("\n\n"),
      );

      const score = await response.score([
        "The assistant converted the workflow to a network-first approach using page.evaluate(fetch).",
        "The assistant removed the old DOM pre-tag parsing approach.",
        "The assistant attempted at least one run command for the updated workflow.",
        "The workflow still returns state and alerts with equivalent output semantics.",
      ]);
      assertPerfectScore(score);
    },
  );
});
