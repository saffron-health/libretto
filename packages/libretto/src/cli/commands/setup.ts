import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureLibrettoSetup,
  LIBRETTO_CONFIG_PATH,
  REPO_ROOT,
} from "../core/context.js";
import { librettoCommand } from "../../shared/package-manager.js";
import { SimpleCLI } from "affordance";

function installBrowsers(): void {
  console.log("Installing Playwright Chromium...");
  const result = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: true,
  });
  if (result.status === 0) {
    console.log("✓ Playwright Chromium installed");
  } else {
    console.error(
      "✗ Failed to install Playwright Chromium. Run manually: npx playwright install chromium",
    );
  }
}

function getPackageSkillsRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up from dist/cli/commands/ to package root
  let dir = dirname(thisFile);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "skills", "libretto"))) {
      return join(dir, "skills");
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate libretto skill files in package");
}

/**
 * Auto-detect .agents/ and .claude/ directories at a given root path.
 */
function detectAgentDirs(root: string): string[] {
  const dirs: string[] = [];
  if (existsSync(join(root, ".agents"))) dirs.push(join(root, ".agents"));
  if (existsSync(join(root, ".claude"))) dirs.push(join(root, ".claude"));
  return dirs;
}

function copySkills(): void {
  const agentDirs = detectAgentDirs(REPO_ROOT);

  if (agentDirs.length === 0) {
    console.log(
      "\n⚠️ No .agents/ or .claude/ directory found. Libretto skills were not installed.",
    );
    console.log(
      `  Create one of these directories in your repo root and rerun \`${librettoCommand("setup")}\` to install skills:`,
    );
    console.log(`    mkdir ${join(REPO_ROOT, ".claude")}`);
    return;
  }

  let skillsRoot: string;
  try {
    skillsRoot = getPackageSkillsRoot();
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const agentDir of agentDirs) {
    const agentName = basename(agentDir);

    for (const skillName of skillNames) {
      const sourceDir = join(skillsRoot, skillName);
      const skillDest = join(agentDir, "skills", skillName);
      if (existsSync(skillDest)) {
        rmSync(skillDest, { recursive: true });
      }
      cpSync(sourceDir, skillDest, { recursive: true });
      const fileCount = readdirSync(skillDest).length;
      console.log(
        `✓ Copied ${fileCount} skill files to ${agentName}/skills/${skillName}/`,
      );
    }
  }
}

export const setupInput = SimpleCLI.input({
  positionals: [],
  named: {
    skipBrowsers: SimpleCLI.flag({
      name: "skip-browsers",
      help: "Skip Playwright Chromium installation",
    }),
  },
});

export const setupCommand = SimpleCLI.command({
  description: "Set up libretto in the current project",
})
  .input(setupInput)
  .handle(async ({ input }) => {
    ensureLibrettoSetup();

    if (!input.skipBrowsers) {
      installBrowsers();
    } else {
      console.log("Skipping browser installation (--skip-browsers)");
    }

    copySkills();

    console.log(`\nConfig set up at ${LIBRETTO_CONFIG_PATH}`);
    console.log("\n✓ libretto setup complete");
  });
