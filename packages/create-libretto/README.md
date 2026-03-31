# create-libretto

Bootstrap Libretto into an existing project.

```bash
npm init libretto@latest
# equivalent: npm create libretto@latest
```

The initializer installs a matching `libretto` version into the current project when needed, then runs Libretto setup:

- refresh the Libretto skill in detected `.agents` or `.claude` directories
- install Playwright Chromium
- configure snapshot-analysis credentials

To rerun setup later without reinstalling `libretto`:

```bash
npx libretto setup
```
