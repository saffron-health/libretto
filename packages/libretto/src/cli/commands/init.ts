import type { Argv } from "yargs";
import { existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../core/context.js";
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

function isCommandDefined(command: string | undefined): boolean {
	if (!command) return false;

	if (command.includes("/") || command.includes("\\")) {
		return existsSync(command);
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
			candidates.some((candidate) => existsSync(join(dir, candidate))),
		);
	}

	return pathEntries.some((dir) => existsSync(join(dir, command)));
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

function getSkillSourceDir(): string {
	// Resolve relative to this file's location in the package
	const thisDir = dirname(fileURLToPath(import.meta.url));
	// From dist/cli/commands/ -> package root
	const pkgRoot = join(thisDir, "..", "..", "..");
	const skillDir = join(pkgRoot, "skill");
	if (existsSync(skillDir)) return skillDir;
	const skillsDir = join(pkgRoot, "skills");
	if (existsSync(skillsDir)) return skillsDir;
	throw new Error(
		"Could not find skill/ or skills/ directory in the libretto package.",
	);
}

function copySkills(): void {
	const src = getSkillSourceDir();
	const files = readdirSync(src);
	if (files.length === 0) {
		console.log("  No skill files found to copy.");
		return;
	}

	const targets = [
		join(REPO_ROOT, ".agents", "skills", "libretto"),
		join(REPO_ROOT, ".claude", "skills", "libretto"),
	];

	for (const target of targets) {
		mkdirSync(target, { recursive: true });
		cpSync(src, target, { recursive: true });
		console.log(`  \u2713 Copied skill files to ${target}`);
	}
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
	if (configReadError) {
		console.log(`  \u2717 Could not read AI config: ${configReadError}`);
		console.log("    Reconfigure with:");
		printAiConfigureCommands("      ");
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
			}
			console.log("    Reconfigure with:");
			printAiConfigureCommands("      ");
			return;
		}

		console.log(
			`  \u2713 Configured (${config.preset}): ${formatCommandPrefix(config.commandPrefix)}`,
		);
		console.log("    Analysis commands are ready to use.");
		return;
	}

	console.log("  \u2717 No AI config set.");
	if (availableCommands.length > 0) {
		console.log(
			`    Detected available commands: ${availableCommands.join(", ")}`,
		);
	} else {
		console.log("    codex, claude, and gemini are not currently available to configure.");
	}
	console.log("    Configure one with:");
	printAiConfigureCommands("      ");
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

			console.log("Copying skill files...");
			try {
				copySkills();
			} catch (err) {
				console.error(
					`  \u2717 ${err instanceof Error ? err.message : String(err)}`,
				);
			}

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
