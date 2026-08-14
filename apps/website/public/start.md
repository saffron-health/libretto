# Set Up Libretto

Install Libretto and verify that it runs end to end.

## 1. Choose the target

Libretto is installed into the target Node.js package. Inspect the current directory and ask only for missing information:

- Create a new Libretto package? If so, where and what package name?
- Add Libretto to an existing Node.js package? If so, which package directory?

Use the target project's package manager conventions. If the user already chose a path, location, name, or package manager, treat that as binding.

## 2. Set up the package

For a new package:

```bash
npm create libretto@latest <package-name>
cd <package-name>
```

For an existing package:

```bash
npm install libretto
npx libretto setup
```

Use equivalent pnpm, yarn, or bun commands when appropriate.

## 3. Read installed guidance

After installation, make sure your current directory is the package directory. Then read the repo-level skill that setup copied into the project before creating or editing workflow code. Use whichever path exists:

```text
.agents/skills/libretto/SKILL.md
.claude/skills/libretto/SKILL.md
```

If neither path exists because the project has no `.agents/` or `.claude/` directory, create the appropriate agent directory and rerun `npx libretto setup`. The package also includes source docs under `node_modules/libretto/docs/`; use them only when the skill or task requires more detail.

## 4. Verify

For this smoke check, copy the workflow below directly; do not inspect the scaffolded example or read additional references unless validation fails.

Create a minimal smoke workflow at `src/workflows/scrape-page.ts` inside the package directory:

```ts
import { workflow } from "libretto";

export default workflow("scrape-page", async ({ page }) => {
  await page.goto("https://example.com");
  const title = await page.title();
  console.log(`Page title: ${title}`);

  return { title };
});
```

Run it with a local browser first:

```bash
npx libretto run src/workflows/scrape-page.ts --headless
```

### If local Chromium fails in a sandbox

Agent sandboxes (for example Claude Cowork) can install npm packages but often cannot launch local Chromium: missing shared libraries (such as `libXdamage.so.1`), no sudo, and blocked `playwright install-deps` / apt. Do not keep retrying apt, sudo, or OS dependency installs.

Fall back in this order:

1. Check auth with `npx libretto cloud auth whoami`. If not logged in, run `npx libretto cloud auth login` yourself (use `npx libretto cloud auth signup` when they need a new account). That command prints a browser sign-in/sign-up URL and waits; share the URL with the user, do not ask them to run the CLI. After auth succeeds, verify with Libretto Cloud:

```bash
npx libretto run src/workflows/scrape-page.ts --provider libretto-cloud
```

2. If cloud auth cannot complete in this environment, stop fighting local Chromium. Treat setup as complete once the package is installed and the smoke workflow exists, and report that browser verification needs Libretto Cloud or a host machine with working Chromium. Do not ask the user to run CLI commands.

## 5. Finish

After verifying Libretto is setup and working properly, summarize the steps taken and offer some sample browser automations you could build next, such as:

- Scrape recent posts from X/Twitter for a keyword, account, or list
- Monitor a product page for price or availability changes
- Fill out a repetitive web form from structured input data
- Collect search results from a directory, marketplace, or documentation site

## Important Instructions and Constraints to be Successful

- Fix only setup-related failures.
- Do not make unrelated changes or invent secrets.
