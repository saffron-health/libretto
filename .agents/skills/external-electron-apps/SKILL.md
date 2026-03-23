---
name: external-electron-apps
description: |
  Automate user-installed Electron desktop apps (Slack, Discord, VS Code, Notion, Figma, Spotify, etc.) via CDP using this repo's Libretto CLI. Use when the task is to control a local desktop app on the user's machine, not this repo's own Electron app. Triggers: "desktop Slack app", "connect to Electron app", "remote-debugging-port", "CDP desktop app", "automate VS Code desktop app".
---

# External Electron App Automation

Use this skill for external Electron desktop apps running on the user's machine.
Do not default to this for this repository's own Electron app unless the user explicitly asks.

## Core workflow

1. Quit the app if it is already running.
2. Relaunch the app with `--remote-debugging-port=<port>`.
3. Connect with `npx libretto connect http://127.0.0.1:<port> --session <session>`.
4. Verify targets with `npx libretto pages --session <session>`.
5. Run interactions with `npx libretto exec "<code>" --session <session>`.
6. Capture evidence with `npx libretto snapshot --session <session>`.

## Launch examples

### macOS

```bash
open -a "Slack" --args --remote-debugging-port=9222
open -a "Visual Studio Code" --args --remote-debugging-port=9223
open -a "Discord" --args --remote-debugging-port=9224
```

### Linux

```bash
slack --remote-debugging-port=9222
code --remote-debugging-port=9223
discord --remote-debugging-port=9224
```

### Windows

```bash
"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222
"C:\Users\%USERNAME%\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9223
```

## Session pattern

Use one session per app:

```bash
npx libretto connect http://127.0.0.1:9222 --session slack-desktop
npx libretto pages --session slack-desktop
npx libretto exec "return await page.title()" --session slack-desktop
npx libretto snapshot --session slack-desktop \
  --objective "Identify the main content area" \
  --context "Connected to the Slack desktop app and need to orient on the current view."
```

## Interaction examples

```bash
npx libretto exec "await page.locator('button:has-text(\"Search\")').click()" --session slack-desktop
npx libretto exec "await page.keyboard.type('incident-123')" --session slack-desktop
npx libretto exec "await page.keyboard.press('Enter')" --session slack-desktop
```

When selectors are unstable, inspect first:

```bash
npx libretto snapshot --session slack-desktop \
  --objective "Find clickable elements near the search area" \
  --context "Trying to locate the search input after clicking the search button."
npx libretto exec "return await page.content()" --session slack-desktop
```

## Multiple pages

Electron apps often have multiple windows/pages. Use `pages` to list them and `--page` to target a specific one:

```bash
npx libretto pages --session slack-desktop
npx libretto exec --session slack-desktop --page <page-id> "return await page.url()"
npx libretto snapshot --session slack-desktop --page <page-id> \
  --objective "Describe the current view" \
  --context "Inspecting a specific Electron window."
```

## Troubleshooting

- If connection fails, make sure the app was launched with `--remote-debugging-port` and relaunch it.
- Prefer `127.0.0.1` over `localhost` in CDP URLs.
- If no pages are listed right after launch, wait 2-5 seconds and retry `pages`.
- If a session is stale, run `connect` again with the same `--session`.

Use `npx libretto close --session <session>` to clear the session. This does not terminate the external app — it only removes the session state so Libretto stops tracking it.
