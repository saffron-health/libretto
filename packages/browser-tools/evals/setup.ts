import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const envPath = join(repoRoot, ".env");

if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq);
		const value = trimmed.slice(eq + 1);
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

export function requireOpenAiApiKey(): string {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY is not loaded. Add it to repo-root .env before running evals.",
		);
	}
	return apiKey;
}

requireOpenAiApiKey();
