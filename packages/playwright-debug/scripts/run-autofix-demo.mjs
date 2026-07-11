// End-to-end harness for the browser-tools autofix debugger.
//
// Reproduces the deliberate sign-in selector failure from
// skills-repo workflows/book-canopy-rooms-autofix-demo.ts, then hands the
// failure to the (browser-tools powered) Libretto debugger, which investigates
// the live page and opens a fix PR against the `autofix-demo` branch.
//
// Requires env: ANTHROPIC_API_KEY, LIBRETTO_API_KEY
// Optional env: LIBRETTO_API_URL (defaults to the local API at :8080)
//
// This runs the *broker* auth path: instead of a raw GitHub token, the
// debugger exchanges LIBRETTO_API_KEY at LIBRETTO_API_URL for a short-lived
// GitHub App installation token (via /v1/github/createInstallationToken).
import { chromium } from "playwright";
import { createLibrettoDebugger } from "../dist/index.js";

const SIGN_IN_URL =
  "https://canopy.satellitedeskworks.com/sign-in?redirect=%2Fdashboard";
const MODEL = process.env.DEBUG_AGENT_MODEL ?? "anthropic/claude-sonnet-4-6";
const LIBRETTO_API_URL = process.env.LIBRETTO_API_URL ?? "http://localhost:8080";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

async function main() {
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const librettoApiKey = requireEnv("LIBRETTO_API_KEY");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Reproduce the workflow failure: the broken workflow fills the wrong
  // selector `input[name="username"]` (the live form uses name="login").
  let failure;
  try {
    await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded" });
    console.log("[harness] on sign-in page:", page.url());
    await page.locator('input[name="username"]').fill("demo-user", {
      timeout: 8000,
    });
    throw new Error("Expected the broken selector to time out, but it did not");
  } catch (error) {
    failure = error;
    console.log("[harness] reproduced failure:", failure.message.split("\n")[0]);
  }

  const librettoDebugger = createLibrettoDebugger({
    github: {
      owner: "saffron-health",
      repo: "skills-repo",
      baseBranch: "autofix-demo",
      // Broker path: no raw GitHub token. The debugger exchanges the Libretto
      // API key for a short-lived GitHub App installation token.
      librettoApiKey,
      librettoApiUrl: LIBRETTO_API_URL,
    },
    agent: {
      model: MODEL,
      apiKey: anthropicKey,
    },
  });

  console.log(
    "[harness] running debugPlaywrightFailure via broker",
    LIBRETTO_API_URL,
    "with model",
    MODEL,
  );
  const result = await librettoDebugger.debugPlaywrightFailure(failure, page, {
    includeFiles: ["workflows/book-canopy-rooms-autofix-demo.ts"],
  });

  console.log("\n===== DEBUGGER RESULT =====");
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error("[harness] failed:", error);
  process.exit(1);
});
