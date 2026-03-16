import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	type AiConfig,
	readAiConfig,
} from "./ai-config.js";
import { REPO_ROOT } from "./context.js";
import {
	hasProviderCredentials,
	missingProviderCredentialsMessage,
	parseModel,
	type Provider,
} from "../../shared/llm/client.js";

const DEFAULT_SNAPSHOT_MODELS = {
	openai: "openai/gpt-5.4",
	anthropic: "anthropic/claude-sonnet-4-6",
	google: "google/gemini-2.5-flash",
	vertex: "vertex/gemini-2.5-pro",
} as const satisfies Record<Provider, string>;

export type SnapshotApiModelSelection = {
	model: string;
	provider: Provider;
	source:
		| "config"
		| "env:auto-openai"
		| "env:auto-anthropic"
		| "env:auto-google"
		| "env:auto-vertex";
};

export class SnapshotApiUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SnapshotApiUnavailableError";
	}
}

function readWorktreeEnvPath(): string | null {
	const gitPath = join(REPO_ROOT, ".git");
	if (!existsSync(gitPath)) return null;

	try {
		const gitPointer = readFileSync(gitPath, "utf-8").trim();
		const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
		if (!match?.[1]) return null;
		const worktreeGitDir = resolve(REPO_ROOT, match[1].trim());
		const commonGitDir = resolve(worktreeGitDir, "..", "..");
		return join(dirname(commonGitDir), ".env");
	} catch {
		return null;
	}
}

export function loadSnapshotEnv(): void {
	if (process.env.LIBRETTO_DISABLE_DOTENV?.trim() === "1") return;

	const envPathCandidates = [
		join(REPO_ROOT, ".env"),
		readWorktreeEnvPath(),
	].filter((value): value is string => Boolean(value));

	const envPath = envPathCandidates.find((candidate) => existsSync(candidate));
	if (!envPath) return;

	for (const line of readFileSync(envPath, "utf-8").split("\n")) {
		const parsed = parseDotEnvAssignment(line);
		if (!parsed) continue;
		if (!(parsed.key in process.env)) {
			process.env[parsed.key] = parsed.value;
		}
	}
}

export function parseDotEnvAssignment(
	line: string,
): { key: string; value: string } | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return null;

	const withoutExport = trimmed.startsWith("export ")
		? trimmed.slice("export ".length).trimStart()
		: trimmed;
	const eqIdx = withoutExport.indexOf("=");
	if (eqIdx < 1) return null;

	const key = withoutExport.slice(0, eqIdx).trim();
	if (!key) return null;

	const rawValue = withoutExport.slice(eqIdx + 1).trimStart();
	if (!rawValue) {
		return { key, value: "" };
	}

	if (rawValue.startsWith('"')) {
		const closeIdx = rawValue.indexOf('"', 1);
		if (closeIdx > 0) {
			return { key, value: rawValue.slice(1, closeIdx) };
		}
		return { key, value: rawValue.slice(1) };
	}

	if (rawValue.startsWith("'")) {
		const closeIdx = rawValue.indexOf("'", 1);
		if (closeIdx > 0) {
			return { key, value: rawValue.slice(1, closeIdx) };
		}
		return { key, value: rawValue.slice(1) };
	}

	const inlineCommentIndex = rawValue.search(/\s#/);
	const value =
		inlineCommentIndex >= 0
			? rawValue.slice(0, inlineCommentIndex).trimEnd()
			: rawValue.trim();
	return { key, value };
}

function inferAutoSnapshotModel(): SnapshotApiModelSelection | null {
	const providersInPriorityOrder: Provider[] = [
		"openai",
		"anthropic",
		"google",
		"vertex",
	];

	for (const provider of providersInPriorityOrder) {
		if (!hasProviderCredentials(provider)) continue;
		return {
			model: DEFAULT_SNAPSHOT_MODELS[provider],
			provider,
			source: `env:auto-${provider}` as SnapshotApiModelSelection["source"],
		};
	}

	return null;
}

/**
 * Resolve which API model to use for snapshot analysis.
 *
 * Priority:
 * 1. Model from .libretto/config.json ai.model field (set via `ai configure`)
 * 2. Auto-detect from available API credentials in env
 */
export function resolveSnapshotApiModel(
	config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection | null {
	loadSnapshotEnv();

	if (config?.model) {
		const { provider } = parseModel(config.model);
		return {
			model: config.model,
			provider,
			source: "config",
		};
	}

	return inferAutoSnapshotModel();
}

export function resolveSnapshotApiModelOrThrow(
	config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection {
	const selection = resolveSnapshotApiModel(config);
	if (!selection) {
		throw new SnapshotApiUnavailableError(
			"No API snapshot analyzer is available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_CLOUD_PROJECT, or run `npx libretto ai configure <provider>` to set a default model.",
		);
	}

	if (!hasProviderCredentials(selection.provider)) {
		throw new SnapshotApiUnavailableError(
			missingProviderCredentialsMessage(selection.provider),
		);
	}

	return selection;
}

export function isSnapshotApiUnavailableError(error: unknown): boolean {
	return error instanceof SnapshotApiUnavailableError;
}
