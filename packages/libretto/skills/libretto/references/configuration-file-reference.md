# Configuration File Reference

Use this reference when you need to inspect or change the workspace configuration that powers `snapshot` analysis and default viewport behavior.

## When to Use This

- You want to confirm which AI model `snapshot` will use.
- You want to understand where Libretto stores workspace-level settings.
- You want a persistent default viewport for `open` or `run`.

## File Location

Libretto reads workspace config from `.libretto/config.json`.

- The file is usually created or updated by `npx libretto ai configure ...`.
- API credentials still come from your shell environment or `.env`. The config file stores the selected model, not the secret itself.
- For first-time setup instructions, follow the main `SKILL.md` flow instead of expanding this reference.

## Supported Settings

- `ai.model` selects the configured analysis model for `snapshot`.
- `viewport` is an optional top-level setting used by `open` and `run` when you do not pass `--viewport`.
- Viewport precedence is: CLI `--viewport`, then `.libretto/config.json`, then the default `1366x768`.

Example:

```json
{
  "version": 1,
  "ai": {
    "model": "openai/gpt-5.4",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "viewport": {
    "width": 1280,
    "height": 800
  }
}
```

## Common Commands

```bash
npx libretto init
npx libretto ai configure openai
npx libretto open https://app.example.com --viewport 1440x900
npx libretto run ./integration.ts main --viewport 1440x900
```

## Notes

- If you want a persistent default viewport for the workspace, add `viewport` to `.libretto/config.json` instead of repeating `--viewport` on every command.
- If `snapshot` analysis is not configured yet, return to the setup steps in the main `SKILL.md` flow.
