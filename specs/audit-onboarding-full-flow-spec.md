## Problem overview

The public onboarding path is "copy install prompt → paste into agent," but that path stops after a local smoke run. The product goal for this work is time to first deployed workflow with minimal human touch. Today that requires a second prompt (`cloud.md` or the Deploying docs), browser Cloud auth, and several docs/CLI mismatches that agents hit as dead ends.

## Solution overview

Treat one agent prompt as the happy path from install through Libretto Cloud deploy and one hosted job. Fix the setup/config/docs mismatches that break agents before deploy. Keep the single unavoidable human step as Cloud browser sign-in; remove every other question and false dependency from the default path.

## Goals

- A new user can copy one website prompt, paste it into an agent, and reach a deployed workflow plus one successful hosted job with only Cloud browser sign-in as a required human step.
- `start.md` (or its successor) covers install → local smoke → Cloud auth → API key → provider config → deploy → hosted job, defaulting to Libretto Cloud.
- `npx libretto setup` leaves a real `.libretto/config.json` so later Cloud steps do not fail on a missing file that setup claimed to create.
- Agent skills are present after `create-libretto` / `setup` without a recovery detour.
- Docs and website CTAs describe the same end-to-end path; alternative providers stay available but off the first-run happy path.

## Non-goals

- No migrations or backfills.
- No redesign of Cloud browser sign-in / org creation itself (browser auth remains the human step).
- No change to alternative-provider deploy paths beyond keeping them out of the default first-run prompt.
- No revival of the older AI-model onboarding work in `specs/setup-command-onboarding-spec.md` unless a later phase explicitly needs it for deploy.
- No website visual redesign beyond prompt copy and linked markdown instructions.

## Audit findings (current state)

### Intended public path today

1. Copy prompt from website/docs: `Fetch and follow https://libretto.sh/start.md ...`
2. Paste into coding agent.
3. Agent follows `apps/website/public/start.md`: choose new vs existing package → install/setup → read skill → write smoke workflow → `npx libretto run ... --headless`.
4. Agent stops and offers sample automations. Deploy is not in this prompt.
5. Deploy requires a separate prompt (`apps/website/public/cloud.md`) or `docs/get-started/deploying.mdx`, then Cloud auth in a browser, API key, config, and `npx libretto cloud deploy .`.

### Friction that blocks agent-proof "time to first deploy"

1. Primary CTA optimizes for local smoke, not first deploy. The Notion goal and the shipped prompt disagree.
2. `cloud.md` requires `.libretto/config.json`, but `setup` only creates `.libretto/` dirs + `.gitignore` and still prints `Config set up at .../config.json`. Agents that trust that message later find no file, or rewrite config incorrectly.
3. `cloud.md` assumes an existing account and only runs `cloud auth login`. New users need `cloud auth signup` (docs overview is correct; the agent prompt is not).
4. Deploying docs ask Cloud vs Kernel/Browserbase/Steel/AWS/GCP before acting. That adds a human decision on the path we want to minimize.
5. Webhook setup is asked mid-flow in `cloud.md`. For first deploy it should be deferred by default.
6. Docs/README still describe setup/`status` behaviors that do not match current CLI (see also drift vs `specs/setup-command-onboarding-spec.md`).
7. Human touch that must remain: Cloud browser signup/login (and later, target-site login/CAPTCHA for real automations). Everything else on the happy path should be agent-owned.

### What already works

- Website copy-prompt UX (`InstallSnippet`) is simple and agent-shaped.
- `create-libretto` template includes `.agents/` and `.claude/`, so skill copy during setup can succeed without a manual mkdir.
- `start.md` already tells agents how to recover if skill dirs are missing.
- Cloud CLI covers signup/login, API key issue, deploy, and `cloud jobs create`.

## Recommended end-to-end happy path

```text
1. Copy one install/deploy prompt from the website
2. Paste into agent
3. Agent fetches start.md (extended) and:
   a. Creates or installs into a Node package
   b. Runs setup (browsers + skills + default config.json)
   c. Reads the installed skill
   d. Writes and runs a local smoke workflow --headless
   e. Runs cloud auth signup or login (human completes browser step)
   f. Issues API key into .env
   g. Sets provider: "libretto-cloud" in .libretto/config.json
   h. Deploys with cloud deploy
   i. Creates one hosted job and confirms completion
4. Agent reports deployment id, workflow names, job result, and the rerun command
```

## Important files/docs/websites for implementation

- `apps/website/public/start.md` — primary agent instructions fetched after paste; must own the happy path through first deploy.
- `apps/website/public/cloud.md` — Cloud-only prompt; should stay for existing projects, but align with signup/login and optional webhooks.
- `apps/website/src/components/InstallSnippet.tsx` — website copy-prompt CTA text.
- `apps/website/src/components/CTA.tsx` — secondary copy-prompt surface.
- `docs/get-started/quickstart.mdx` — docs mirror of the install prompt and manual path.
- `docs/get-started/first-workflow.mdx` — intermediate step today; may become optional once start.md owns smoke + deploy.
- `docs/get-started/deploying.mdx` — currently forces a provider-routing question; happy path should default to Cloud.
- `docs/libretto-cloud-hosting/overview.mdx` — Cloud setup truth for signup → key → deploy.
- `packages/libretto/src/cli/commands/setup.ts` — setup messaging and skill install; should write default config.
- `packages/libretto/src/cli/core/context.ts` — `.libretto` paths and `ensureLibrettoSetup()`.
- `packages/libretto/src/cli/core/config.ts` — config read/write helpers to reuse for default config creation.
- `packages/create-libretto/template/` — scaffold including `.agents` / `.claude`.
- `packages/libretto/skills/libretto/SKILL.md` — agent guidance after install; should mention deploy validation path.
- `packages/libretto/README.template.md` — install/setup wording; sync mirrors after edits.

## Implementation

### Phase 1: Make setup create a real default config.json

Stop lying to agents. When setup runs and no config exists, write a minimal valid `.libretto/config.json`. When one exists, leave it alone. Change the success line so it only claims a file that is present.

```ts
// packages/libretto/src/cli/commands/setup.ts
ensureLibrettoSetup();
ensureDefaultLibrettoConfig(); // writes { version: 1 } if missing
...
console.log(`\nConfig ready at ${LIBRETTO_CONFIG_PATH}`);
```

- [ ] Add a helper that writes default config only when the file is absent
- [ ] Call it from `setup`
- [ ] Update setup tests to assert the file exists after setup and is not overwritten on rerun
- [ ] Success criteria: `npx libretto setup --skip-browsers` in an empty package creates `.libretto/config.json` with `version: 1`

### Phase 2: Extend start.md through first Cloud deploy and hosted job

Change the primary fetched instructions so the agent does not stop at local smoke. Default to Libretto Cloud. Require human action only for browser auth. Defer webhooks unless the user asks.

- [ ] After local verify, add Cloud steps: signup-or-login, API key to `.env`, set `provider: "libretto-cloud"`, deploy, create one job, confirm result
- [ ] Tell the agent to use `cloud auth signup` for new users and `login` when the user already has an account; do not assume an account exists
- [ ] Keep local smoke as a gate before Cloud steps so install failures are cheap to debug
- [ ] Success criteria: an agent following only `start.md` has explicit steps through `cloud deploy` and one hosted job, with no provider-routing question

### Phase 3: Align website prompt + Cloud prompt + get-started docs

Make every first-run surface point at the same outcome: first deployed workflow.

- [ ] Update `InstallSnippet` / docs quickstart prompt copy if needed so "deployed workflow" is the stated outcome (or keep setup wording but link the extended `start.md`)
- [ ] Align `cloud.md` with signup/login and deferred webhooks for existing projects
- [ ] Update `docs/get-started/deploying.mdx` so the default agent prompt takes Libretto Cloud first; keep alternative providers as a manual branch
- [ ] Fix README/setup/`status` wording that still describes removed AI onboarding behavior
- [ ] Run `pnpm sync:mirrors` if README or skill source files change
- [ ] Success criteria: website prompt, `start.md`, quickstart, and Cloud overview describe one happy path; no doc still requires a pre-existing config file that setup does not create

### Phase 4: Smoke the agent path in a clean package

Verify the repaired path outside the monorepo so skill copy, config creation, local run, and deploy instructions hang together.

- [ ] From a temp directory, follow the updated `start.md` as far as possible without Cloud credentials
- [ ] Confirm skills land under `.agents` or `.claude`, config.json exists, and local smoke run succeeds headless
- [ ] With Cloud credentials available, continue through deploy + one job and record the exact human step(s) remaining
- [ ] Success criteria: only Cloud browser auth remains as a required human step on the happy path; no agent dead ends from missing config or missing skills

## Future work

- Device-code or headless-friendlier Cloud auth for agents that cannot open a GUI browser.
- Optional one-shot "deploy this smoke workflow" sample in `create-libretto` so deploy has a known entrypoint without rewriting files.
- Reconcile or retire stale AI-setup claims in `specs/setup-command-onboarding-spec.md` relative to current CLI behavior.
