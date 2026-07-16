export const GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";

export const DEBUGGER_DOCS_URL = "/docs/reference/runtime/playwright-debugger";
export const DEBUGGER_CONCEPT_URL =
  "/docs/understand-libretto/autofix-debugging";

export const DEBUGGER_PROMPT =
  "Add the Libretto Playwright debugging agent to my existing automation. " +
  "Install libretto-playwright-debugger, then follow " +
  "https://libretto.sh/docs/reference/runtime/playwright-debugger. Create a " +
  "module-scope playwrightDebugger with createPlaywrightDebugger, my repo " +
  "(owner, repo, baseBranch), and model configuration, using LIBRETTO_API_KEY " +
  "for GitHub authentication. At the existing failure point, before " +
  "Playwright teardown, call await " +
  "playwrightDebugger.debugFailure(error, page) with the live page that " +
  "observed the failure. Keep my existing workflow, fallbacks, retries, " +
  "logging, and rethrow behavior in place.";
