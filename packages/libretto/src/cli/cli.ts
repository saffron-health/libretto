import { ensureLibrettoSetup } from "./core/context.js";
import { createCLIApp } from "./router.js";

function renderUsage(app: ReturnType<typeof createCLIApp>): string {
  return `${app.renderHelp()}

Options:
  --session <name>        Use a named session (auto-generated for open/run if omitted)

Examples:
  libretto open https://linkedin.com

  # ... manually log in ...
  libretto save linkedin.com
  # Next time you open linkedin.com, you'll be logged in automatically

  libretto exec "await page.locator('button:has-text(\\"Sign in\\")').click()"
  libretto exec "await page.fill('input[name=\\"email\\"]', 'test@example.com')"
  libretto readonly-exec "return await page.title()" --session test1
  libretto connect http://127.0.0.1:9222 --read-only --session test1
  libretto run ./integration.ts workflowName --read-only --session test1
  libretto status
  libretto ai configure openai
  libretto ai configure anthropic
  libretto ai configure gemini
  libretto ai configure vertex
  libretto ai configure openai/gpt-4o
  libretto snapshot
  libretto snapshot --objective "Find the submit button" --context "Submitting a referral form, already filled in patient details"
  libretto resume --session my-session
  libretto close
  libretto close --all
  libretto close --all --force

  # Multiple sessions
  libretto open https://site1.com --session test1
  libretto open https://site2.com --session test2
  libretto exec "return await page.title()" --session test1

Available in exec:
  page, context, state, browser, networkLog, actionLog

Available in readonly-exec:
  page, state, snapshot, scrollBy, get

Profiles:
  Profiles are saved to .libretto/profiles/<domain>.json (git-ignored)
  They persist cookies, localStorage, and session data across browser launches.
  Local profiles are machine-local and are not shared with other users/environments.
  Sessions can expire; if run fails auth, log in again and re-save the profile.

Sessions:
  Session state is stored in .libretto/sessions/<session>/state.json
  CLI logs are stored in .libretto/sessions/<session>/logs.jsonl
  Each session runs an isolated browser instance on a dynamic port.
  Session mode is stored per session as read-only or write-access.
  Use --read-only on open, connect, or run to create a read-only session.
  Session mode is enforced by Libretto commands, not by raw CDP clients outside Libretto.
`;
}

function isRootHelpRequest(rawArgs: readonly string[]): boolean {
  if (rawArgs.length === 0) return true;
  if (rawArgs[0] === "--help" || rawArgs[0] === "-h") return true;
  return rawArgs[0] === "help" && rawArgs.length === 1;
}

export async function runLibrettoCLI(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let exitCode = 0;
  ensureLibrettoSetup();
  const app = createCLIApp();

  try {
    if (isRootHelpRequest(rawArgs)) {
      console.log(renderUsage(app));
      return;
    }

    const result = await app.run(rawArgs);
    if (typeof result === "string") {
      console.log(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Unknown command: ")) {
      console.error(`${message}\n`);
      console.log(renderUsage(app));
    } else {
      console.error(message);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}
