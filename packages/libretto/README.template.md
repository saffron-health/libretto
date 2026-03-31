# Libretto

[![npm version](https://img.shields.io/npm/v/libretto)](https://www.npmjs.com/package/libretto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub Discussions](https://img.shields.io/github/discussions/saffron-health/libretto)](https://github.com/saffron-health/libretto/discussions)

Libretto is a toolkit for building robust web integrations. It gives your coding agent a live browser and a token-efficient CLI to:

- Inspect live pages with minimal context overhead
- Capture network traffic to reverse-engineer site APIs
- Record user actions and replay them as automation scripts
- Debug broken workflows interactively against the real site

We at [Saffron Health](https://saffron.health) built Libretto to help us maintain our browser integrations to common healthcare software. We're open-sourcing it so other teams have an easier time doing the same thing.

https://github.com/user-attachments/assets/9b9a0ab3-5133-4b20-b3be-459943349d18

## Installation

```bash
npm install libretto

# Install skill, download Chromium if not already installed, configure snapshot analysis
npx libretto init

# Configure or change the snapshot analysis model (see Configuration section below). `npx libretto init` sets this up the first time.
npx libretto ai configure <openai | anthropic | gemini | vertex>
```

## Use cases

Libretto is designed to be used as a skill through your coding agent. Here are some example prompts:

### One-shot script generation

> Use the Libretto skill. Go on LinkedIn and scrape the first 10 posts for content, who posted it, the number of reactions, the first 25 comments, and the first 25 reposts.

Your coding agent will open a window for you to log into LinkedIn, and then automatically start exploring.

### Interactive script building

> I'm gonna show you a workflow in the eclinicalworks EHR to get a patient's primary insurance ID. Use libretto skill to turn it into a playwright script that takes patient name and dob as input to get back the insurance ID. URL is ...

Libretto can read your actions you perform in the browser, so you can perform a workflow, then ask it to use your actions to rebuild the workflow.

### Convert browser automation to network requests

> We have a browser script at ./integration.ts that automates going to Hacker News and getting the first 10 posts. Convert it to direct network scripts instead. Use the Libretto skill.

Libretto can read network requests from the browser, which it can use to reverse engineer the API and create a script that directly calls those requests. Directly making API calls is faster, and more reliable, than UI automation. You can also ask Libretto to conduct a security analysis which analyzes the requests for common security cookies, so you can understand whether a network request approach will be safe.

### Fix broken integrations

> We have a browser script at ./integration.ts that is supposed to go to Availity and perform an eligibility check for a patient. But I'm getting a broken selector error when I run it. Fix it. Use the Libretto skill.

Agents can use Libretto to reproduce the failure, pause the workflow at any point, inspect the live page, and fix issues, all autonomously.

### CLI usage

You can also use Libretto directly from the command line. All commands accept `--session <name>` to target a specific session.

```bash
npx libretto init                          # interactive; run yourself, not through an agent
npx libretto open <url>                    # launch browser and open a URL (headed by default)
npx libretto snapshot --objective "..." --context "..."  # capture PNG + HTML and analyze with an LLM
npx libretto exec "<code>"                 # execute Playwright TypeScript against the open page (single quoted argument)
echo "<code>" | npx libretto exec -        # intentionally read Playwright TypeScript from stdin
npx libretto run <file> <workflowName>     # run an exported workflow from a file
npx libretto resume                        # resume a paused workflow
npx libretto network                       # view captured network requests
npx libretto actions                       # view captured user/agent actions
npx libretto pages                         # list open pages in the session
npx libretto save <domain>                 # save browser session (cookies, localStorage) for reuse
npx libretto close                         # close the browser
npx libretto ai configure <provider>       # configure snapshot analysis model
```

## Configuration

All Libretto state lives in a `.libretto/` directory at your project root. Configuration is stored in `.libretto/config.json`.

### Config file

`.libretto/config.json` controls snapshot analysis and viewport settings:

```json
{
  "version": 1,
  "ai": {
    "model": "openai/gpt-5.4",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "viewport": { "width": 1280, "height": 800 }
}
```

The `ai` field configures which model Libretto uses for snapshot analysis — extracting selectors, identifying interactive elements, or diagnosing why a step failed. This keeps heavy visual context out of your coding agent's context window. Snapshot analysis is required.

The easiest way to set the model is through the CLI:

```bash
npx libretto ai configure <openai | anthropic | gemini | vertex>
```

Provider credentials are read from environment variables or a `.env` file at your project root: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`, or `GOOGLE_CLOUD_PROJECT` for Vertex.

The `viewport` field sets the default browser viewport size. Both fields are optional.

### Sessions

Each Libretto session gets its own directory under `.libretto/sessions/<name>/` containing runtime state. Sessions are git-ignored.

- `state.json` — session metadata (debug port, PID, status)
- `logs.jsonl` — structured session logs
- `network.jsonl` — captured network requests
- `actions.jsonl` — recorded user actions
- `snapshots/` — screenshot PNGs and HTML snapshots

### Profiles

Profiles save browser sessions (cookies, localStorage) so you can reuse authenticated state across runs. They are stored in `.libretto/profiles/<domain>.json`, created via `npx libretto save <domain>`. Profiles are machine-local and git-ignored.

## Community

Have a question, idea, or want to share what you've built? Join the conversation on [GitHub Discussions](https://github.com/saffron-health/libretto/discussions).

- **[Q&A](https://github.com/saffron-health/libretto/discussions/categories/q-a)** — Ask questions and get help
- **[Ideas](https://github.com/saffron-health/libretto/discussions/categories/ideas)** — Suggest new features or improvements
- **[Show and tell](https://github.com/saffron-health/libretto/discussions/categories/show-and-tell)** — Share your workflows and automations
- **[General](https://github.com/saffron-health/libretto/discussions/categories/general)** — Chat about anything Libretto-related

Found a bug? Please [open an issue](https://github.com/saffron-health/libretto/issues/new).

## Authors

Maintained by the team at [Saffron Health](https://saffron.health).

## Development

For local development in this repository:

```bash
pnpm i
pnpm build
pnpm type-check
pnpm test
```

Source layout:

- `{{LIBRETTO_PATH_PREFIX}}src/cli/` — CLI commands
- `{{LIBRETTO_PATH_PREFIX}}src/runtime/` — browser runtime (network, recovery, downloads, extraction)
- `{{LIBRETTO_PATH_PREFIX}}src/shared/` — shared utilities (config, LLM client, logging, state)
- `{{LIBRETTO_PATH_PREFIX}}test/` — test files (`*.spec.ts`)
- `{{LIBRETTO_PATH_PREFIX}}README.template.md` — source of truth for the repo and package READMEs
- `{{LIBRETTO_PATH_PREFIX}}skills/libretto/` — source of truth for the Libretto skill

Run `pnpm sync:mirrors` after editing `{{LIBRETTO_PATH_PREFIX}}README.template.md` or anything under `{{LIBRETTO_PATH_PREFIX}}skills/libretto/`. `pnpm i` also resyncs the skill mirrors through `postinstall`.

To check that generated READMEs, skill mirrors, and skill version metadata are in sync without fixing them, run `pnpm check:mirrors`. To release, run `pnpm prepare-release`.
