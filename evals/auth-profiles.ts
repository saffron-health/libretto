import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLoggerForSession } from "../packages/libretto/src/cli/core/context.js";
import {
  getProfilePath,
  normalizeDomain,
  normalizeUrl,
  runClose,
  runOpen,
  runSave,
} from "../packages/libretto/src/cli/core/browser.js";
import { resolveExperiments } from "../packages/libretto/src/cli/core/experiments.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const evalsRoot = resolve(here);
const profilesRoot = join(evalsRoot, "profiles");

export function normalizeAuthProfileDomain(value: string): string {
  return normalizeDomain(normalizeUrl(value));
}

export function evalAuthProfilePath(domain: string): string {
  return join(profilesRoot, `${domain}.json`);
}

export function hasEvalAuthProfile(domain: string): boolean {
  return existsSync(evalAuthProfilePath(domain));
}

export function missingAuthProfileMessage(domain: string): string {
  return [
    `Missing eval auth profile for ${domain}.`,
    `Expected profile file: ${evalAuthProfilePath(domain)}`,
    `Create it with: pnpm evals profiles login ${domain}`,
  ].join("\n");
}

export async function provisionAuthProfile(
  domain: string,
  evalWorkspaceDir: string,
): Promise<void> {
  const source = evalAuthProfilePath(domain);
  if (!existsSync(source)) {
    throw new Error(missingAuthProfileMessage(domain));
  }

  const target = join(
    evalWorkspaceDir,
    ".libretto",
    "profiles",
    `${domain}.json`,
  );
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

function sessionNameForDomain(domain: string): string {
  const sanitized = domain.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `eval-profile-${sanitized}-${process.pid}`;
}

export async function loginAuthProfile(domain: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("profiles login is interactive and requires a TTY.");
  }

  const normalizedDomain = normalizeAuthProfileDomain(domain);
  const session = sessionNameForDomain(normalizedDomain);
  const logger = createLoggerForSession(session);
  const readline = createInterface({ input, output });

  try {
    const evalProfilePath = evalAuthProfilePath(normalizedDomain);
    const librettoProfilePath = getProfilePath(normalizedDomain);
    if (existsSync(evalProfilePath)) {
      await mkdir(dirname(librettoProfilePath), { recursive: true });
      await copyFile(evalProfilePath, librettoProfilePath);
    }

    process.stdout.write(
      [
        `Opening https://${normalizedDomain} in a headed browser.`,
        "Log in manually, including any MFA or CAPTCHA steps.",
        "When the browser is fully logged in, return here and press Enter to save the profile.",
        "",
      ].join("\n"),
    );

    await runOpen(`https://${normalizedDomain}`, true, session, logger, {
      accessMode: "write-access",
      experiments: resolveExperiments(),
    });

    await readline.question("Press Enter after login is complete...");
    await runSave(normalizedDomain, session, logger);

    await mkdir(dirname(evalProfilePath), { recursive: true });
    await copyFile(librettoProfilePath, evalProfilePath);

    process.stdout.write(
      [
        `Saved eval auth profile for ${normalizedDomain}.`,
        `Location: ${evalProfilePath}`,
      ].join("\n") + "\n",
    );
  } finally {
    readline.close();
    try {
      await runClose(session, logger);
    } finally {
      await logger.close();
    }
  }
}
