import { execFileSync } from "node:child_process";
import { Agent, type AgentTool, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: generate-changelog.ts <tag>");
  console.error("Example: generate-changelog.ts v0.5.2");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required.");
  process.exit(1);
}

const ALLOWED_GH_SUBCOMMANDS = new Set(["pr"]);
const ALLOWED_ACTIONS = new Set(["view", "diff"]);
const SQUASH_MERGE_PR_NUMBER_PATTERN = /\(#(?<number>\d+)\)\s*$/;
const MERGE_COMMIT_PR_NUMBER_PATTERN = /^Merge pull request #(?<number>\d+) /;

interface GitHubRelease {
  tagName: string;
  isDraft?: boolean;
  publishedAt?: string;
}

interface CompareCommit {
  commit: {
    message: string;
  };
}

interface CompareResponse {
  commits: CompareCommit[];
}

interface PullRequestLabel {
  name: string;
}

interface PullRequestFile {
  path: string;
}

interface PullRequestDetails {
  number: number;
  title: string;
  body?: string | null;
  mergedAt?: string | null;
  url: string;
  labels: PullRequestLabel[];
  files: PullRequestFile[];
}

interface ReleaseContext {
  previousTag: string;
  currentRef: string;
  pullRequests: PullRequestDetails[];
}

function runGh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
  });
}

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function getRepoNameWithOwner(): string {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  return runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
}

function getPreviousReleaseTag(currentTag: string): string {
  const releases = parseJson<GitHubRelease[]>(
    runGh(["release", "list", "--limit", "50", "--json", "tagName,isDraft,publishedAt"]),
  ).filter((release) => !release.isDraft);

  const currentIndex = releases.findIndex((release) => release.tagName === currentTag);
  if (currentIndex >= 0) {
    const previousRelease = releases[currentIndex + 1];
    if (previousRelease) {
      return previousRelease.tagName;
    }
  }

  const previousRelease = releases.find((release) => release.tagName !== currentTag);
  if (previousRelease) {
    return previousRelease.tagName;
  }

  throw new Error(`Could not find a previous GitHub release before ${currentTag}.`);
}

function getCurrentRef(currentTag: string): string {
  try {
    const release = parseJson<{ targetCommitish: string }>(
      runGh(["release", "view", currentTag, "--json", "targetCommitish"]),
    );
    if (release.targetCommitish) {
      return release.targetCommitish;
    }
  } catch {
    // The release does not exist yet when this runs in the release workflow.
  }

  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }

  return runGit(["rev-parse", "HEAD"]);
}

function collectMergedPullRequestNumbers(repoNameWithOwner: string, previousTag: string, currentRef: string): number[] {
  const compare = parseJson<CompareResponse>(
    runGh(["api", `repos/${repoNameWithOwner}/compare/${previousTag}...${currentRef}`]),
  );
  const numbers: number[] = [];
  const seen = new Set<number>();

  for (const compareCommit of compare.commits) {
    const firstLine = compareCommit.commit.message.split("\n", 1)[0] ?? "";
    const match = SQUASH_MERGE_PR_NUMBER_PATTERN.exec(firstLine) ?? MERGE_COMMIT_PR_NUMBER_PATTERN.exec(firstLine);
    if (!match?.groups?.number) {
      continue;
    }

    const number = Number(match.groups.number);
    if (!seen.has(number)) {
      seen.add(number);
      numbers.push(number);
    }
  }

  return numbers;
}

function getPullRequestDetails(number: number): PullRequestDetails {
  return parseJson<PullRequestDetails>(
    runGh([
      "pr",
      "view",
      String(number),
      "--json",
      "number,title,body,mergedAt,url,labels,files",
    ]),
  );
}

function shouldIncludePullRequest(pr: PullRequestDetails): boolean {
  const labelNames = new Set(pr.labels.map((label) => label.name));
  if (labelNames.has("release") || labelNames.has("skip-changelog")) {
    return false;
  }

  return !pr.title.toLowerCase().startsWith("release:");
}

function buildReleaseContext(currentTag: string): ReleaseContext {
  const repoNameWithOwner = getRepoNameWithOwner();
  const previousTag = getPreviousReleaseTag(currentTag);
  const currentRef = getCurrentRef(currentTag);
  const pullRequests = collectMergedPullRequestNumbers(repoNameWithOwner, previousTag, currentRef)
    .map((number) => getPullRequestDetails(number))
    .filter(shouldIncludePullRequest);

  if (pullRequests.length === 0) {
    throw new Error(`No changelog-eligible PRs found in ${previousTag}...${currentRef}.`);
  }

  return { previousTag, currentRef, pullRequests };
}

const releaseContext = buildReleaseContext(tag);
const allowedPullRequestNumbers = new Set(releaseContext.pullRequests.map((pr) => String(pr.number)));
const pullRequestSummary = releaseContext.pullRequests
  .map((pr) => {
    const labels = pr.labels.map((label) => label.name).join(", ") || "none";
    const files = pr.files.map((file) => file.path).join(", ") || "none";
    return [
      `PR #${pr.number}: ${pr.title}`,
      `Merged at: ${pr.mergedAt ?? "unknown"}`,
      `Labels: ${labels}`,
      `Files: ${files}`,
      `Body:\n${pr.body?.trim() || "(empty)"}`,
    ].join("\n");
  })
  .join("\n\n");

const GhToolParamsSchema = Type.Object({
  args: Type.String({ description: "Arguments to pass to gh (without the leading 'gh')" }),
});

type GhToolParams = Static<typeof GhToolParamsSchema>;

const ghTool: AgentTool = {
  name: "gh",
  label: "GitHub CLI",
  description: [
    "Run a read-only GitHub CLI command. The arguments are passed directly to `gh`.",
    "Examples:",
    "'pr view 128 --json title,body,files', 'pr diff 128'.",
    "Only the release PRs precomputed by the changelog harness can be inspected.",
  ].join(" "),
  parameters: GhToolParamsSchema,
  execute: async (_toolCallId: string, rawParams: unknown) => {
    const params = rawParams as GhToolParams;
    const args = params.args.trim();
    const parts = args.split(/\s+/);
    const subcommand = parts[0];

    if (!subcommand || !ALLOWED_GH_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`Subcommand '${subcommand}' is not allowed. Allowed: ${[...ALLOWED_GH_SUBCOMMANDS].join(", ")}`);
    }

    const action = parts[1];
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Action '${action}' is not allowed. Allowed: ${[...ALLOWED_ACTIONS].join(", ")}`);
    }

    if (subcommand === "pr" && (action === "view" || action === "diff")) {
      const number = parts[2];
      if (!number || !allowedPullRequestNumbers.has(number)) {
        throw new Error(
          `PR #${number ?? "(missing)"} is outside the ${releaseContext.previousTag}...${releaseContext.currentRef} release range.`,
        );
      }
    }
    try {
      const output = runGh(parts);
      return { content: [{ type: "text", text: output }], details: {} };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`gh command failed: ${message}`);
    }
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt: [
      `Generate release notes for the ${tag} release of Libretto.`,
      "",
      `The release range is ${releaseContext.previousTag}...${releaseContext.currentRef}.`,
      "The changelog harness has already found the merged PRs in that exact range.",
      "Only write about the PRs listed below. Do not mention open PRs, branches, issues, or other work outside this list.",
      "",
      pullRequestSummary,
      "",
      "Use the gh tool to inspect the listed PRs before writing notes.",
      "Useful queries:",
      "- 'pr diff NUMBER' to see the full diff of a PR (base to head, not individual commits)",
      "- 'pr view NUMBER --json title,body,files' to see PR details",
      "",
      "IMPORTANT: Always read the full PR diff to understand what actually changed.",
      "Do NOT rely solely on PR titles and descriptions — they may be incomplete or misleading.",
      "The diff is the source of truth for what the release note should say.",
      "",
      "Guidelines:",
      "- Write concise, user-facing release notes in markdown.",
      "- Group changes into sections like Features, Fixes, and Improvements. Only include sections that have entries.",
      "- Focus on what changed from the user's perspective, not internal implementation details.",
      "- Do NOT include PR numbers or links.",
      "- Skip PRs labeled 'skip-changelog'.",
      "- Your response must contain ONLY the raw markdown release notes. No preamble like 'Here are the release notes'. No commentary or explanation. No '---' separators. The very first character of your response must be '#'. Example format:",
      "",
      "## Features",
      "",
      "- **Thing**: Description",
    ].join("\n"),
    model: getModel("anthropic", "claude-sonnet-4-6"),
    tools: [ghTool],
  },
});

let finalText = "";

agent.subscribe((event: AgentEvent) => {
  if (event.type === "agent_end") {
    const messages = event.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
            finalText = block.text as string;
            return;
          }
        }
      }
    }
  }
});

await agent.prompt("Generate the release notes now.");

if (!finalText) {
  console.error("Changelog generation failed: no text output from agent.");
  process.exit(1);
}

// Strip any preamble before the first markdown heading.
const headingIndex = finalText.indexOf("\n#");
if (headingIndex >= 0) {
  finalText = finalText.slice(headingIndex + 1);
} else if (finalText.startsWith("#")) {
  // Already starts with a heading, keep as-is.
} else {
  console.error("Changelog generation failed: output does not contain markdown headings.");
  process.exit(1);
}

process.stdout.write(finalText);
