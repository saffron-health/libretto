# Configuration File Reference

Use this reference when you need to inspect or change workspace configuration for default browser behavior.

## When to Use This

- You want to understand where Libretto stores workspace-level settings.
- You want a persistent default viewport for `open` or `run`.
- You want a persistent default browser provider, such as Kernel, Browserbase, or Steel.

## File Location

Libretto reads workspace config from `.libretto/config.json`.

- The file is created by `libretto setup` during first-time onboarding.
- Use `libretto status` to inspect open sessions without changing anything.
- For first-time setup instructions, follow the main `SKILL.md` flow instead of expanding this reference.

## Supported Settings

- `provider` is an optional top-level setting used by `open` and `run` when you do not pass `--provider` and do not set `LIBRETTO_PROVIDER`. Must be `"local"`, `"kernel"`, `"browserbase"`, `"steel"`, or `"libretto-cloud"`.
- Provider precedence is: CLI `--provider`, then `LIBRETTO_PROVIDER`, then `.libretto/config.json`, then `"local"`.
- Provider credentials belong in the repo root `.env` file, which Libretto loads automatically before running CLI commands.
- `viewport` is an optional top-level setting used by `open` and `run` when you do not pass `--viewport`.
- Viewport precedence is: CLI `--viewport`, then `.libretto/config.json`, then the default `1366x768`.
- `sessionMode` sets the default session access mode for new sessions created by `open`, `connect`, and `run`. Must be `"read-only"` or `"write-access"`. When omitted, defaults to `"write-access"`. Pass `--read-only` or `--write-access` to `open`, `connect`, or `run` to override when creating a session.

Example:

```json
{
  "version": 1,
  "provider": "kernel",
  "viewport": {
    "width": 1280,
    "height": 800
  },
  "sessionMode": "write-access"
}
```

## Common Commands

```bash
libretto setup                                         # first-time onboarding
libretto status                                        # inspect open sessions
libretto open https://example.com --provider kernel
libretto run ./integration.ts --provider browserbase
libretto open https://example.com --provider steel
libretto open https://example.com --viewport 1440x900
libretto run ./integration.ts --viewport 1440x900
```

## Notes

- If you want a persistent default provider for the workspace, add `provider` to `.libretto/config.json` instead of repeating `--provider` on every command.
- If you want a persistent default viewport for the workspace, add `viewport` to `.libretto/config.json` instead of repeating `--viewport` on every command.
- Run `libretto status` at any time to check open sessions.
