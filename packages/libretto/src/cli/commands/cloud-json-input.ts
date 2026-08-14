import { readFileSync } from "node:fs";

export function parseJsonObject(
  label: string,
  raw: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function readJsonObjectFile(
  label: string,
  filePath: string,
): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      `Could not read ${label} "${filePath}". Ensure the file exists and is readable.`,
    );
  }
  return parseJsonObject(label, content);
}

export function jsonObjectInput(
  inlineLabel: string,
  inline: string | undefined,
  fileLabel: string,
  filePath: string | undefined,
): Record<string, unknown> {
  if (inline && filePath) {
    throw new Error(`Pass either ${inlineLabel} or ${fileLabel}, not both.`);
  }
  if (inline) return parseJsonObject(inlineLabel, inline);
  if (!filePath) return {};
  return readJsonObjectFile(fileLabel, filePath);
}
