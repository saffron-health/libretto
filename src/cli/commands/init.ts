import type { Argv } from "yargs";
import { accessSync, constants, statSync } from "node:fs";
import { join, delimiter, extname } from "node:path";
import { spawnSync } from "node:child_process";
import {
	AI_CONFIG_PRESETS,
	AiPresetSchema,
	formatCommandPrefix,
	readAiConfig,
} from "../core/ai-config.js";

const AI_RUNTIME_PRESETS = AiPresetSchema.options;
type AIRuntimePreset = (typeof AI_RUNTIME_PRESETS)[number];

function getPresetCommand(preset: AIRuntimePreset): string {
	return AI_CONFIG_PRESETS[preset][0] ?? "";
}

function isRunnableFile(filePath: string): boolean {
	try {
		const stats = statSync(filePath);
		if (!stats.isFile()) return false;

		if (process.platform === "win32") {
			const pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
			const extensions = pathExt
				.split(";")
				.map((ext) => ext.trim().toUpperCase())
				.filter(Boolean);
			const fileExt = extname(filePath).toUpperCase();
			return extensions.includes(fileExt);
		}

		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function isCommandDefined(command: string | undefined): boolean {
	if (!command) return false;

	if (command.includes("/") || command.includes("\\")) {
		return isRunnableFile(command);
	}

	const pathEnv = process.env.PATH ?? "";
	if (!pathEnv) return false;

	const pathEntries = pathEnv.split(delimiter).filter(Boolean);
	if (process.platform === "win32") {
		const pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
		const extensions = pathExt
			.split(";")
			.map((ext) => ext.trim())
			.filter(Boolean);
		const hasExtension = /\.[^./\\]+$/.test(command);
		const candidates = hasExtension
			? [command]
			: extensions.map((ext) =>
				ext.startsWith(".") ? `${command}${ext}` : `${command}.${ext}`,
			);

		return pathEntries.some((dir) =>
			candidates.some((candidate) => isRunnableFile(join(dir, candidate))),
		);
	}

	return pathEntries.some((dir) => isRunnableFile(join(dir, command)));
}

function detectAvailableAiRuntimeCommands(): AIRuntimePreset[] {
	return AI_RUNTIME_PRESETS.filter((preset): preset is AIRuntimePreset =>
		isCommandDefined(getPresetCommand(preset)),
	);
}

function printAiConfigureCommands(prefix: string = "    "): void {
	for (const preset of AI_RUNTIME_PRESETS) {
		console.log(`${prefix}npx libretto ai configure ${preset}`);
	}
}

function printDifferentAnalyzerHint(prefix: string = "    "): void {
	console.log(
		`${prefix}Use npx libretto ai configure <gemini|claude|codex> to configure a different AI analyzer.`,
	);
}

function installBrowsers(): void {
	console.log("\nInstalling Playwright Chromium...");
	const result = spawnSync("npx", ["playwright", "install", "chromium"], {
		stdio: "inherit",
		shell: true,
	});
	if (result.status === 0) {
		console.log("  \u2713 Playwright Chromium installed");
	} else {
		console.error(
			"  \u2717 Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
		);
	}
}

function checkAiRuntimeConfiguration(): void {
	let config: ReturnType<typeof readAiConfig> = null;
	let configReadError: string | null = null;

	try {
		config = readAiConfig();
	} catch (error) {
		configReadError = error instanceof Error ? error.message : String(error);
	}

	const availableCommands = detectAvailableAiRuntimeCommands();

	console.log("\nAI runtime configuration:");
	console.log(
		"  Libretto can use your coding agent as a subagent to analyze snapshots and other page signals.",
	);
	console.log(
		"  This is optional, but it significantly improves page understanding and debugging performance.",
	);
	if (configReadError) {
		console.log(`  \u2717 Could not read AI config: ${configReadError}`);
		console.log("    Reconfigure with:");
		printAiConfigureCommands("      ");
		printDifferentAnalyzerHint("    ");
		return;
	}

	if (config) {
		const configuredCommand = config.commandPrefix[0];
		if (!isCommandDefined(configuredCommand)) {
			console.log(
				`  \u2717 Configured command not found: ${configuredCommand ?? "(empty)"}`,
			);
			if (availableCommands.length > 0) {
				console.log(
					`    Detected available commands: ${availableCommands.join(", ")}`,
				);
			} else {
				console.log(
					"    No codex, claude, or gemini analyzer command was detected on PATH.",
				);
			}
			console.log("    Reconfigure with:");
			printAiConfigureCommands("      ");
			printDifferentAnalyzerHint("    ");
			return;
		}

		console.log(
			`  \u2713 Configured (${config.preset}): ${formatCommandPrefix(config.commandPrefix)}`,
		);
		console.log("    Analysis commands are ready to use.");
		printDifferentAnalyzerHint("    ");
		return;
	}

	console.log("  \u2717 No AI config set.");
	if (availableCommands.length > 0) {
		console.log(
			`    Detected available commands: ${availableCommands.join(", ")}`,
		);
	} else {
		console.log("    No codex, claude, or gemini analyzer command was detected on PATH.");
	}
	console.log("    Configure one with:");
	printAiConfigureCommands("      ");
	printDifferentAnalyzerHint("    ");
	console.log("    Optionally provide a custom command prefix with '-- ...'.");
}

export function registerInitCommand(yargs: Argv): Argv {
	return yargs.command(
		"init",
		"Initialize libretto in the current project",
		(cmd) =>
			cmd.option("skip-browsers", {
				type: "boolean",
				default: false,
				describe: "Skip Playwright Chromium installation",
			}),
			(argv) => {
				console.log("Initializing libretto...\n");

				if (!argv["skip-browsers"]) {
					installBrowsers();
				} else {
				console.log("\nSkipping browser installation (--skip-browsers)");
			}

			checkAiRuntimeConfiguration();

			console.log("\n\u2713 libretto init complete");
		},
	);
}
