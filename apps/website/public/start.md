# Set Up Libretto

Install Libretto and verify that it runs end to end.

## 1. Install the Libretto CLI

Before anything else, install the global `libretto` CLI. This is required for every path below and must be run first. It is safe to rerun if Libretto is already installed. Requires Node.js and npm:

```bash
curl -fsSL https://libretto.sh/install.sh | bash
```

Verify the CLI is on PATH by running `libretto --help` before continuing.

## 2. Choose the target

Inspect the current directory. Ask only for missing information:

- Create a new Libretto package? If so, where and what package name?
- Add Libretto to an existing Node.js package? If so, which package directory?

Use the target project's package manager conventions. If the user already chose a path, location, name, or package manager, treat that as binding.

## 3. Set up the package

For a new package:

```bash
npm create libretto@latest <package-name>
cd <package-name>
```

After creating a new package, do all remaining setup and verification inside the created package directory.

For an existing package:

```bash
npm install libretto
libretto setup
```

Use equivalent pnpm, yarn, or bun commands when appropriate.

## 4. Read installed guidance

After installation, make sure your current directory is the package directory. Then read the installed skill before creating or editing workflow code:

```text
node_modules/libretto/skills/libretto/SKILL.md
```

The package also includes docs under `node_modules/libretto/docs/`; use them only when the skill or task requires more detail.

## 5. Verify

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

Run it:

```bash
libretto run src/workflows/scrape-page.ts --headless
```

## 6. Finish

After verifying Libretto is setup and working properly, summarize the steps taken and offer some sample browser automations you could build next, such as:

- Scrape recent posts from X/Twitter for a keyword, account, or list
- Monitor a product page for price or availability changes
- Fill out a repetitive web form from structured input data
- Collect search results from a directory, marketplace, or documentation site

## Important Instructions and Constraints to be Successful

- Fix only setup-related failures.
- Do not make unrelated changes or invent secrets.
