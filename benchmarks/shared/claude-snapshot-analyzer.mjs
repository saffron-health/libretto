import { readFile } from "node:fs/promises";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

const ResultSchema = z.object({
  answer: z.string(),
  selectors: z
    .array(
      z.object({
        label: z.string(),
        selector: z.string(),
        rationale: z.string(),
      }),
    )
    .default([]),
  notes: z.string().default(""),
});

const SCREENSHOT_HINT =
  /\n*Screenshot file path: (?<pngPath>[^\n]+)\nUse the screenshot alongside the HTML snapshot context above\.\s*$/s;

function extractPromptAndScreenshotPath(rawPrompt) {
  const match = rawPrompt.match(SCREENSHOT_HINT);
  if (!match?.groups?.pngPath) {
    throw new Error(
      "Snapshot analyzer prompt did not include a screenshot path.",
    );
  }

  return {
    prompt: rawPrompt.replace(SCREENSHOT_HINT, "").trim(),
    pngPath: match.groups.pngPath.trim(),
  };
}

async function readPromptInput() {
  const argvPrompt = process.argv.slice(2).join(" ").trim();
  if (argvPrompt) {
    return argvPrompt;
  }

  if (process.stdin.isTTY) {
    return "";
  }

  let stdinPrompt = "";
  for await (const chunk of process.stdin) {
    stdinPrompt += chunk.toString();
  }
  return stdinPrompt.trim();
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY for benchmark snapshot analysis.");
  }

  const rawPrompt = await readPromptInput();
  if (!rawPrompt) {
    throw new Error("Benchmark snapshot analyzer expected a prompt on argv or stdin.");
  }

  const { prompt, pngPath } = extractPromptAndScreenshotPath(rawPrompt);
  const imageBuffer = await readFile(pngPath);
  const modelId =
    process.env.LIBRETTO_BENCHMARK_ANALYZER_MODEL?.trim() ||
    "claude-sonnet-4-6";
  const anthropic = createAnthropic({ apiKey });

  const result = await generateObject({
    model: anthropic(modelId),
    temperature: 0,
    schema: ResultSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "You are the Libretto snapshot analyzer for browser benchmark runs.",
              "Return only content that matches the provided JSON schema.",
              "Base the answer on the screenshot and the HTML/context embedded in the prompt.",
              "",
              prompt,
            ].join("\n"),
          },
          {
            type: "image",
            image: imageBuffer,
          },
        ],
      },
    ],
  });

  process.stdout.write(JSON.stringify(result.object));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
