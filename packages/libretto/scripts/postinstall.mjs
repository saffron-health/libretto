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

	const skillsRoot = join(installRoot, ".agents", "skills");
	if (!isDirectory(skillsRoot)) {
		log(`Skipped: "${skillsRoot}" does not exist.`);
		return;
	}

	const sourceSkillsDir = join(packageDir, "skills");
	if (!isDirectory(sourceSkillsDir)) {
		log(`Skipped: source skills directory not found at "${sourceSkillsDir}".`);
		return;
	}

	const skillCopies = [
		{ source: "original-skill", destination: "libretto" },
		{
			source: "libretto-network-skill",
			destination: "libretto-network-skill"
		}
	];

	let syncedCount = 0;
	for (const { source, destination } of skillCopies) {
		const sourceSkillDir = join(sourceSkillsDir, source);
		if (!isDirectory(sourceSkillDir)) {
			log(`Skipped: source skill directory not found at "${sourceSkillDir}".`);
			continue;
		}

		const destinationSkillDir = join(skillsRoot, destination);
		mkdirSync(destinationSkillDir, { recursive: true });
		cpSync(sourceSkillDir, destinationSkillDir, { recursive: true, force: true });
		log(`Synced skill "${destination}" to "${destinationSkillDir}".`);
		syncedCount += 1;
	}

	if (syncedCount === 0) {
		log("Skipped: no source skill directories were synced.");
	}
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`[libretto postinstall] Warning: ${message}`);
}
