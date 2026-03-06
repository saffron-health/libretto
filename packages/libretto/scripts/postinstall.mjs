import { cpSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isDirectory(path) {
	if (!existsSync(path)) return false;
	return lstatSync(path).isDirectory();
}

function log(message) {
	console.log(`[libretto postinstall] ${message}`);
}

function main() {
	const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : null;
	const installRoot = initCwd ?? process.cwd();

	const sourceSkillDir = join(packageDir, "skill");
	if (!isDirectory(sourceSkillDir)) {
		log(`Skipped: source skill directory not found at "${sourceSkillDir}".`);
		return;
	}

	const targets = [
		join(installRoot, ".agents", "skills"),
		join(installRoot, ".claude", "skills"),
	];

	for (const skillsRoot of targets) {
		if (!isDirectory(skillsRoot)) {
			log(`Skipped: "${skillsRoot}" does not exist.`);
			continue;
		}

		const destinationSkillDir = join(skillsRoot, "libretto");
		mkdirSync(destinationSkillDir, { recursive: true });
		cpSync(sourceSkillDir, destinationSkillDir, { recursive: true, force: true });
		log(`Synced skill "libretto" to "${skillsRoot}/libretto".`);
	}
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`[libretto postinstall] Warning: ${message}`);
}
