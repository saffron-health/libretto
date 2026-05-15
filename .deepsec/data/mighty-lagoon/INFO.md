# mighty-lagoon

## What this codebase does

Libretto is a pnpm TypeScript monorepo for browser automation workflows. The main package (`packages/libretto`) ships a CLI, daemon-backed browser runtime, Playwright helpers, skills, and docs; `apps/website` and `docs` are public-facing docs/marketing surfaces. Users run Libretto locally or through hosted browser providers to inspect pages, capture network traffic, record actions, replay workflows, and execute Playwright code against live browser sessions.

## Auth shape

- `LIBRETTO_API_KEY` is the explicit env credential for hosted Libretto APIs and wins over stored session cookies.
- `readAuthState`, `writeAuthState`, and `clearAuthState` manage `~/.libretto/auth.json`; cookies are persisted there with mode 0600.
- `pickCredential`, `authFetch`, `betterAuthCall`, and `orpcCall` attach either `x-api-key` or `cookie` to hosted API requests.
- `createLibrettoCloudProvider` uses `LIBRETTO_API_KEY` to create/close remote browser sessions and receive CDP/live-view URLs.
- Local browser sessions and daemon IPC are controlled through session state files under `.libretto/`, not through web auth middleware.

## Threat model

Highest-impact issues are credential disclosure, unauthorized access to hosted browser sessions, unsafe execution of user-provided Playwright/TypeScript snippets, and bypasses of readonly execution protections. Browser sessions can contain authenticated third-party app state, network traffic, screenshots, downloads, and generated scripts, so leaking CDP endpoints, cookies, headers, recordings, logs, or workflow artifacts can expose sensitive user data. Treat local filesystem writes, generated code, `.env` loading, daemon IPC, cloud-provider APIs, and captured browser/network data as security-sensitive.

## Project-specific patterns to flag

- Code that logs, stores, exports, or returns `LIBRETTO_API_KEY`, auth cookies, CDP URLs, live-view URLs, replay URLs, request headers, screenshots, downloads, or page/network bodies without redaction.
- Changes to `compileExecFunction`, `handleExec`, `DaemonExecRepl`, or workflow-running paths that broaden execution scope beyond the intended Playwright helper context.
- Changes to `createReadonlyExecHelpers`, `wrapPageForReadonlyExec`, `wrapLocatorForReadonlyExec`, or readonly fetch guards that allow navigation, clicks, typing, POST/PUT/PATCH/DELETE requests, request bodies, arbitrary properties, or raw page access.
- File/path handling around `.libretto/`, profile files, workflow artifacts, downloads, skill mirrors, temp workspaces, and generated scripts where attacker-controlled names could escape the intended workspace.
- Hosted-provider or auth command changes that trust client-supplied organization/session identifiers; server-side APIs are expected to enforce tenant/session authorization.

## Known false-positives

- `libretto exec` and workflow replay intentionally execute user-supplied Playwright code in a local/developer-controlled context; findings should focus on privilege expansion or secret leakage, not the existence of execution itself.
- `readonly-exec` intentionally allows read-only page/locator inspection and GET-style fetches; mutation-capable operations are the suspicious cases.
- `pageRequest` intentionally executes browser-context fetches to help users reverse-engineer site APIs; investigate unsafe logging or credential handling rather than all browser fetch usage.
- Test fixtures, benchmarks, evals, docs examples, and skill markdown often contain intentionally broad prompts or sample commands and are not production auth boundaries.
- The marketing website and Mintlify docs are public static surfaces unless they start handling secrets, auth callbacks, form submissions, or server-side data access.
