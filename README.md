# Libretto

Libretto gives your coding agent superpowers for building, debugging, and maintaining browser RPA integrations.

It is designed for engineering teams that automate workflows in web apps and want to move from brittle browser-only scripts to faster, more reliable network-first integrations.

## Installation

```bash
npm install --save-dev libretto
```

Then initialize Libretto:

```bash
npx libretto init
```

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

Snapshot analysis uses the API-based analyzer by default when supported credentials are available. Supported providers are:

- `OPENAI_API_KEY` for OpenAI / Codex-style models
- `ANTHROPIC_API_KEY` for Anthropic
- `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini API
- `GOOGLE_CLOUD_PROJECT` (plus ADC credentials) for Vertex AI

You can override the snapshot model explicitly with `LIBRETTO_SNAPSHOT_MODEL=provider/model-id`, for example `openai/gpt-5-mini`, `anthropic/claude-sonnet-4-6`, `google/gemini-2.5-flash`, or `vertex/gemini-2.5-flash`.
`codex/gpt-5-mini` is also accepted as an alias for the OpenAI provider.

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
