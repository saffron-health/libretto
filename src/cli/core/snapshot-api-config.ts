import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	AI_CONFIG_PRESETS,
	type AiConfig,
	isDefaultCommandPrefixForPreset,
	readAiConfig,
} from "./ai-config.js";
import { REPO_ROOT } from "./context.js";
import {
	hasProviderCredentials,
	missingProviderCredentialsMessage,
	parseModel,
	type Provider,
} from "../../shared/llm/client.js";

export const SNAPSHOT_MODEL_ENV_VAR = "LIBRETTO_SNAPSHOT_MODEL";

const DEFAULT_SNAPSHOT_MODELS = {
	openai: "openai/gpt-5-mini",
	anthropic: "anthropic/claude-sonnet-4-6",
	google: "google/gemini-2.5-flash",
	vertex: "vertex/gemini-2.5-flash",
} as const satisfies Record<Provider, string>;

export type SnapshotApiModelSelection = {
	model: string;
	provider: Provider;
	source:
		| "env:LIBRETTO_SNAPSHOT_MODEL"
		| "ai-config"
		| "factory-fallback"
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

function decodeDotEnvEscapes(value: string): string {
	return value
		.replace(/\\n/g, "\n")
		.replace(/\\"/g, '"')
		.replace(/\\'/g, "'");
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

	if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
		const quote = rawValue[0]!;
		let value = "";
		let escaped = false;

		for (let i = 1; i < rawValue.length; i += 1) {
			const char = rawValue[i]!;
			if (escaped) {
				value += char;
				escaped = false;
				continue;
			}
			if (quote === '"' && char === "\\") {
				escaped = true;
				continue;
			}
			if (char === quote) {
				return { key, value: decodeDotEnvEscapes(value) };
			}
			value += char;
		}

		return { key, value: decodeDotEnvEscapes(rawValue.slice(1)) };
	}

	const inlineCommentIndex = rawValue.search(/\s#/);
	const value =
		inlineCommentIndex >= 0
			? rawValue.slice(0, inlineCommentIndex).trimEnd()
			: rawValue.trim();
	return { key, value: decodeDotEnvEscapes(value) };
}

function providerToPreset(provider: Provider): AiConfig["preset"] {
	switch (provider) {
		case "openai":
			return "codex";
		case "anthropic":
			return "claude";
		case "google":
		case "vertex":
			return "gemini";
	}
}

function resolveModelFromConfig(config: AiConfig): string {
	const modelOverride = config.model?.trim();
	if (modelOverride) {
		if (modelOverride.includes("/")) return modelOverride;
		switch (config.preset) {
			case "codex":
				return `openai/${modelOverride}`;
			case "claude":
				return `anthropic/${modelOverride}`;
			case "gemini":
				if (hasProviderCredentials("google")) return `google/${modelOverride}`;
				if (hasProviderCredentials("vertex")) return `vertex/${modelOverride}`;
				return `google/${modelOverride}`;
		}
	}

	switch (config.preset) {
		case "codex":
			return DEFAULT_SNAPSHOT_MODELS.openai;
		case "claude":
			return DEFAULT_SNAPSHOT_MODELS.anthropic;
		case "gemini":
			if (hasProviderCredentials("google")) {
				return DEFAULT_SNAPSHOT_MODELS.google;
			}
			if (hasProviderCredentials("vertex")) {
				return DEFAULT_SNAPSHOT_MODELS.vertex;
			}
			return DEFAULT_SNAPSHOT_MODELS.google;
	}
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

export function resolveSnapshotApiModel(
	config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection | null {
	loadSnapshotEnv();

	const explicitModel = process.env[SNAPSHOT_MODEL_ENV_VAR]?.trim();
	if (explicitModel) {
		const { provider } = parseModel(explicitModel);
		return {
			model: explicitModel,
			provider,
			source: "env:LIBRETTO_SNAPSHOT_MODEL",
		};
	}

	if (config && isDefaultCommandPrefixForPreset(config)) {
		const model = resolveModelFromConfig(config);
		const { provider } = parseModel(model);
		return {
			model,
			provider,
			source: "ai-config",
		};
	}

	if (!config) {
		return inferAutoSnapshotModel();
	}

	return null;
}

export function resolveSnapshotApiModelOrThrow(
	config: AiConfig | null = readAiConfig(),
): SnapshotApiModelSelection {
	const selection = resolveSnapshotApiModel(config);
	if (!selection) {
		throw new SnapshotApiUnavailableError(
			"No API snapshot analyzer is available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_CLOUD_PROJECT, or configure a custom CLI analyzer with `libretto ai configure ... -- <command prefix...>`.",
		);
	}

	if (!hasProviderCredentials(selection.provider)) {
		throw new SnapshotApiUnavailableError(
			`${missingProviderCredentialsMessage(selection.provider)} You can also override the snapshot model with ${SNAPSHOT_MODEL_ENV_VAR}=provider/model-id.`,
		);
	}

	return selection;
}

export function shouldUseApiSnapshotAnalyzer(
	config: AiConfig | null = readAiConfig(),
): boolean {
	loadSnapshotEnv();

	if (process.env[SNAPSHOT_MODEL_ENV_VAR]?.trim()) {
		return true;
	}

	if (!config) {
		return inferAutoSnapshotModel() !== null;
	}

	return isDefaultCommandPrefixForPreset(config);
}

export function buildSnapshotApiSelectionConfig(
	selection: SnapshotApiModelSelection,
	config: AiConfig | null = readAiConfig(),
): AiConfig {
	const preset = providerToPreset(selection.provider);
	return {
		preset,
		commandPrefix: config?.commandPrefix ?? AI_CONFIG_PRESETS[preset].commandPrefix,
		model: selection.model,
		updatedAt: new Date(0).toISOString(),
	};
}

export function isSnapshotApiUnavailableError(error: unknown): boolean {
	return error instanceof SnapshotApiUnavailableError;
}

export function getFactoryFallbackSnapshotApiModelSelection(): SnapshotApiModelSelection {
	return {
		model: DEFAULT_SNAPSHOT_MODELS.google,
		provider: "google",
		source: "factory-fallback",
	};
}
