import type { Argv } from "yargs";
import { existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../core/context.js";
import { formatCommandPrefix, readAiConfig } from "../core/ai-config.js";

const AI_RUNTIME_COMMANDS = ["codex", "claude", "gemini"] as const;
type AIRuntimeCommand = (typeof AI_RUNTIME_COMMANDS)[number];

function isCommandDefined(command: string | undefined): boolean {
	if (!command) return false;

	if (command.includes("/") || command.includes("\\")) {
		return existsSync(command);
	}

	const result = spawnSync("which", [command], { stdio: "ignore" });
	return result.status === 0;
}

function detectAvailableAiRuntimeCommands(): AIRuntimeCommand[] {
	return AI_RUNTIME_COMMANDS.filter((command): command is AIRuntimeCommand =>
		isCommandDefined(command),
	);
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
	const config = readAiConfig();
	const availableCommands = detectAvailableAiRuntimeCommands();

	console.log("\nAI runtime configuration:");
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
			console.log("      npx libretto ai configure codex");
			console.log("      npx libretto ai configure claude");
			console.log("      npx libretto ai configure gemini");
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
	console.log("      npx libretto ai configure codex");
	console.log("      npx libretto ai configure claude");
	console.log("      npx libretto ai configure gemini");
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
