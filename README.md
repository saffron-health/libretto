<!-- Generated from packages/libretto/README.template.md by `pnpm sync:mirrors`. Do not edit directly. -->

# Libretto

[![npm version](https://img.shields.io/npm/v/libretto)](https://www.npmjs.com/package/libretto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub Discussions](https://img.shields.io/github/discussions/saffron-health/libretto)](https://github.com/saffron-health/libretto/discussions)
[![Discord](https://img.shields.io/badge/Discord-Join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/NYrG56hVDt)

Libretto is a toolkit for building robust web integrations. It gives your coding agent a live browser and a token-efficient CLI to:

- Inspect live pages with minimal context overhead
- Capture network traffic to reverse-engineer site APIs
- Record user actions and replay them as automation scripts
- Debug broken workflows interactively against the real site

We at [Saffron Health](https://saffron.health) built Libretto to help us maintain our browser integrations to common healthcare software. We're open-sourcing it so other teams have an easier time doing the same thing.

https://github.com/user-attachments/assets/9b9a0ab3-5133-4b20-b3be-459943349d18

### Quick Links

- Website: [libretto.sh](https://libretto.sh)
- Docs: [libretto.sh/docs](https://libretto.sh/docs)
- Repository: [github.com/saffron-health/libretto](https://github.com/saffron-health/libretto)
- Discord: [discord.gg/NYrG56hVDt](https://discord.gg/NYrG56hVDt)

## Installation

```bash
npm install libretto

# First-time onboarding: install skill, download Chromium, and pin the default snapshot model
npx libretto setup

# Check workspace readiness at any time
npx libretto status

# Manually change the snapshot analysis model (advanced override)
npx libretto ai configure <openai | anthropic | gemini | vertex>
```

`setup` detects available provider credentials (e.g. `OPENAI_API_KEY`) and automatically pins the default model to `.libretto/config.json`. Re-running `setup` on a healthy workspace shows the current configuration instead of re-prompting. If credentials are missing for a previously configured provider, `setup` offers an interactive repair flow.

Use `ai configure` when you want to explicitly switch providers or set a custom model string.

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
npx libretto open <url>                    # launch browser and open a URL
npx libretto snapshot --objective "..."    # capture PNG + HTML and analyze with an LLM
npx libretto exec "<code>"                 # execute Playwright TypeScript against the open page
npx libretto close                         # close the browser
```

Run `npx libretto help` for the full list of commands.

## Configuration

All Libretto state lives in a `.libretto/` directory at your project root. See the [configuration docs](https://libretto.sh/docs/configuration) for details on config files, sessions, and profiles.

## Join the Community

Join our Discord to connect with other developers, get help, and share what you've built:

[![Discord](https://img.shields.io/badge/Discord-Join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/NYrG56hVDt)

For longer-form threads, head to [GitHub Discussions](https://github.com/saffron-health/libretto/discussions). Found a bug? [Open an issue](https://github.com/saffron-health/libretto/issues/new).

## License

[MIT License](LICENSE) — use it freely in commercial and open-source projects.

## Development

For local development in this repository:

```bash
pnpm i
pnpm build
pnpm type-check
pnpm test
```

Source layout:

- `packages/libretto/src/cli/` — CLI commands
- `packages/libretto/src/runtime/` — browser runtime (network, recovery, downloads, extraction)
- `packages/libretto/src/shared/` — shared utilities (config, LLM client, logging, state)
- `packages/libretto/test/` — test files (`*.spec.ts`)
- `packages/libretto/README.template.md` — source of truth for the repo and package READMEs
- `packages/libretto/skills/libretto/` — source of truth for the Libretto skill

Run `pnpm sync:mirrors` after editing `packages/libretto/README.template.md` or anything under `packages/libretto/skills/libretto/`.

To check that generated READMEs, skill mirrors, and skill version metadata are in sync without fixing them, run `pnpm check:mirrors`. To release, run `pnpm prepare-release`.

---

> [!NOTE]
> This is an early-stage project under active development. APIs may change before version 1.0. We recommend pinning to specific versions in production.

Built by the team at [Saffron Health](https://saffron.health).
