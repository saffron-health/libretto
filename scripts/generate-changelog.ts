import { execFileSync } from "node:child_process";
import { Agent, type AgentTool, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

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

const ALLOWED_GH_SUBCOMMANDS = new Set(["pr", "release", "repo", "issue"]);
const ALLOWED_ACTIONS = new Set(["list", "view", "diff", "status", "checks"]);

const ghTool: AgentTool = {
  name: "gh",
  label: "GitHub CLI",
  description: [
    "Run a read-only GitHub CLI command. The arguments are passed directly to `gh`.",
    "Examples: 'release list --limit 5', 'pr list --state merged --json number,title',",
    "'pr view 128 --json title,body,files', 'pr diff 128'.",
    "Only read operations are allowed (list, view, diff, etc.). Mutating commands will be rejected.",
  ].join(" "),
  parameters: Type.Object({
    args: Type.String({ description: "Arguments to pass to gh (without the leading 'gh')" }),
  }),
  execute: async (_toolCallId, rawParams) => {
    const params = rawParams as { args: string };
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

    try {
      const output = execFileSync("gh", parts, {
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
      });
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
      "Use the gh tool to explore what changed since the previous release.",
      "Useful queries:",
      "- 'release list --limit 5' to find the previous release tag",
      "- 'pr list --state merged --limit 50 --json number,title,body,labels' to find merged PRs",
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
