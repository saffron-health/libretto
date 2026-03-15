# Libretto

Libretto gives your coding agent superpowers for building, debugging, and maintaining browser RPA integrations.

It is designed for engineering teams that automate workflows in web apps and want to move from brittle browser-only scripts to faster, more reliable network-first integrations.

## Installation

```bash
npm install --save-dev libretto
```

Chromium is downloaded automatically via a `postinstall` script. If postinstall scripts are disabled (e.g. `--ignore-scripts`, common in monorepos), run init manually:

```bash
npx libretto init
```

This installs the Chromium browser binary and optionally configures an AI runtime for snapshot analysis.

## Usage

Libretto is usually used through prompts with the Libretto skill.

### One-shot script generation

```text
Use the Libretto skill. Go on LinkedIn and scrape the first 10 posts for content, who posted it, the number of reactions, the first 25 comments, and the first 25 reposts.
```

### Interactive script building

```text
Use the Libretto skill. Let's interactively build a script to scrape scheduling info from the eClinicalWorks EHR.
```

### Convert browser automation to network requests

```text
We have a browser script at ./integration.ts that automates going to Hacker News and getting the first 10 posts. Convert it to direct network scripts instead. Use the Libretto skill.
```

### Fix broken integrations

```text
We have a browser script at ./integration.ts that is supposed to go to Availity and perform an eligibility check for a patient. But I'm getting a broken selector error when I run it. Fix it. Use the Libretto skill.
```

You can also run workflows directly from the CLI:

```bash
npx libretto help
npx libretto run ./integration.ts main
```

## The `.libretto/` directory

Libretto stores local runtime state in a `.libretto/` directory at your project root. Sensitive directories (`sessions/` and `profiles/`) are automatically git-ignored via `.libretto/.gitignore`.

- **`profiles/<domain>.json`** — Saved browser sessions (cookies, localStorage) for authenticated sites. Created via `npx libretto save <domain>`. Machine-local and never committed.
- **`sessions/<name>/`** — Per-session runtime state:
  - `state.json` — Session metadata (debug port, PID, status)
  - `logs.jsonl` — Structured session logs
  - `network.jsonl` — Captured network requests (URLs, methods, headers, response status)
  - `actions.jsonl` — Recorded user actions (clicks, fills, navigations)
  - `snapshots/` — Screenshot PNGs and HTML snapshots captured via `npx libretto snapshot`
- **`ai.json`** — AI runtime configuration set via `npx libretto ai configure`.

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
