import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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
const HTML_SNAPSHOT_MARKER = "HTML snapshot:\n\n";
const JSON_INSTRUCTION_MARKER =
  "\n\nReturn only a JSON object. Do not include markdown code fences or extra commentary.";
const MAX_HTML_SNAPSHOT_CHARS = 100_000;

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

export async function readPromptInput({
  argv = process.argv.slice(2),
  stdin = process.stdin,
} = {}) {
  const argvPrompt = argv.join(" ").trim();
  if (argvPrompt) {
    return argvPrompt;
  }

  let stdinPrompt = "";
  for await (const chunk of stdin) {
    stdinPrompt += chunk.toString();
  }

  return stdinPrompt.trim();
}

function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return [
    text.slice(0, headChars),
    "",
    `[truncated HTML snapshot: showing first ${headChars} chars and last ${tailChars} chars of ${text.length}]`,
    "",
    text.slice(-tailChars),
  ].join("\n");
}

export function truncatePromptForBenchmarkAnalyzer(
  prompt,
  maxHtmlChars = MAX_HTML_SNAPSHOT_CHARS,
) {
  const htmlStart = prompt.indexOf(HTML_SNAPSHOT_MARKER);
  if (htmlStart < 0) {
    return prompt;
  }

  const htmlContentStart = htmlStart + HTML_SNAPSHOT_MARKER.length;
  const htmlEnd = prompt.lastIndexOf(JSON_INSTRUCTION_MARKER);
  if (htmlEnd <= htmlContentStart) {
    return prompt;
  }

  const htmlSnapshot = prompt.slice(htmlContentStart, htmlEnd);
  if (htmlSnapshot.length <= maxHtmlChars) {
    return prompt;
  }

  return [
    prompt.slice(0, htmlContentStart),
    truncateMiddle(htmlSnapshot, maxHtmlChars),
    prompt.slice(htmlEnd),
  ].join("");
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY for benchmark snapshot analysis.");
  }

  const rawPrompt = await readPromptInput();
  if (!rawPrompt) {
    throw new Error(
      "Benchmark snapshot analyzer expected a prompt via argument or stdin.",
    );
  }

  const { prompt: extractedPrompt, pngPath } = extractPromptAndScreenshotPath(rawPrompt);
  const prompt = truncatePromptForBenchmarkAnalyzer(extractedPrompt);
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
            image: `data:image/png;base64,${imageBuffer.toString("base64")}`,
          },
        ],
      },
    ],
  });

  process.stdout.write(JSON.stringify(result.object));
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
