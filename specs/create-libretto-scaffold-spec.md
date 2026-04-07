# `create-libretto` project scaffolding

## Problem overview

`create-libretto` currently just runs `npm install libretto` + `npx libretto setup` in the current directory. There's no project scaffolding — no `package.json`, no example workflow, no `tsconfig.json`. Users wanting to start a new browser automation package from scratch have to set everything up manually. The docs also don't explain how to add Libretto to an existing repo without the scaffolder.

## Solution overview

Rewrite `create-libretto` to scaffold a complete project directory with template files (package.json, tsconfig, example workflow, index.ts entry point, README), detect the user's package manager, install dependencies, run `libretto setup`, and print next steps. Add a "Manual setup" docs page for existing repos.

## Goals

- A user runs `npm create libretto my-project` (or pnpm/yarn/bun equivalent) and gets a working project with an example workflow they can immediately run and deploy.
- A user with an existing repo can follow a docs page to add Libretto manually.
- The scaffolded project works with `npx libretto run` and `npx libretto experimental deploy` out of the box.

## Non-goals

- No interactive prompts beyond project name (no framework selection, no template variants).
- No migrations or backfills.
- No multiple template options — one template only.
- No custom project configuration (TypeScript-only, no JS option).

## Future work

- Template variants (e.g., minimal vs. full example).
- Interactive add-on selection (auth profiles, cloud config).
- `libretto experimental deploy` leaving experimental status.

## Important files/docs/websites for implementation

- `packages/create-libretto/index.mjs` — Current create-libretto entry point (to be rewritten).
- `packages/create-libretto/package.json` — Package manifest (needs `files` update for template dir).
- `packages/libretto/src/shared/workflow/workflow.ts` — `workflow()` factory signature and `LibrettoWorkflowContext` type.
- `packages/libretto/src/cli/commands/setup.ts` — What `libretto setup` does (creates `.libretto/`, installs browsers, configures AI).
- `packages/libretto/src/cli/core/deploy-artifact.ts` — Deploy reads `index.ts` as default entry point, discovers exported workflows.
- `docs/docs.json` — Mintlify nav config (add new page).
- `docs/get-started/introduction.mdx` — Current getting started page (update to reference both flows).
- Vite's `pkgFromUserAgent()` pattern — `npm_config_user_agent` parsing for package manager detection.

## Implementation

### Phase 1: Add template directory with project files

Create the static template files that will be copied into new projects. After this phase, the template directory exists in the package but isn't wired up yet.

- [x] Create `packages/create-libretto/template/_gitignore` with entries for `node_modules`, `.libretto/sessions/`, `.libretto/profiles/`, `dist/`
- [x] Create `packages/create-libretto/template/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [x] Create `packages/create-libretto/template/src/shared/utils.ts` with a trivial helper:

```ts
export function log(message: string): void {
  console.log(`[libretto] ${message}`);
}
```

- [x] Create `packages/create-libretto/template/src/workflows/star-repo.ts`:

```ts
import { workflow } from "libretto";
import { log } from "../shared/utils.js";

export const starRepo = workflow("star-repo", async ({ page }) => {
  log("Navigating to Libretto repo...");
  await page.goto("https://github.com/saffron-health/libretto");
  await page.locator('button:has-text("Star")').click();
  log("Starred the repo!");
});
```

- [x] Create `packages/create-libretto/template/src/index.ts`:

```ts
export { starRepo } from "./workflows/star-repo.js";
```

- [x] Create `packages/create-libretto/template/README.md`:

````md
# {{projectName}}

Browser automations built with [Libretto](https://libretto.sh).

## Development

Start exploring a page interactively:

\```bash
{{runCommand}} libretto open https://example.com --headed
\```

Run a workflow:

\```bash
{{runCommand}} libretto run src/workflows/star-repo.ts
\```

## Deploy

\```bash
{{runCommand}} libretto experimental deploy .
\```

## Learn more

- [Libretto docs](https://libretto.sh)
- [CLI reference](https://libretto.sh/cli-reference/open-and-connect)
- [Workflow API](https://libretto.sh/library-api/workflow)
````

- [x] Create `packages/create-libretto/template/package.json.template`:

```json
{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "libretto open --headed",
    "build": "tsc"
  },
  "dependencies": {
    "libretto": "{{librettoVersion}}"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [x] Verify all template files exist under `packages/create-libretto/template/` with correct structure

### Phase 2: Rewrite create-libretto with template copying and package manager detection

Replace the current `index.mjs` with scaffolding logic: parse args, detect package manager, copy template, patch placeholders, install deps, run setup, print next steps.

```ts
function detectPackageManager(): "npm" | "pnpm" | "yarn" | "bun" {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

function scaffoldProject(targetDir, projectName, pkgManager) {
  // 1. Copy template/ to targetDir (rename _gitignore → .gitignore)
  // 2. Read package.json.template, replace {{projectName}}/{{librettoVersion}}, write as package.json
  // 3. Read README.md, replace {{projectName}}/{{runCommand}}
  // 4. Run <pkgManager> install
  // 5. Run <pkgManager> exec libretto setup
  // 6. Print next steps
}
```

- [x] Rewrite `packages/create-libretto/index.mjs` to:
  - Parse `process.argv[2]` as project name (default: `libretto-automations`)
  - Error if target directory already exists and is non-empty
  - Detect package manager from `npm_config_user_agent`
  - Copy all files from `template/` to target directory recursively
  - Rename `_gitignore` to `.gitignore`
  - Read `package.json.template`, replace `{{projectName}}` and `{{librettoVersion}}`, write as `package.json` (delete the `.template` file)
  - Read `README.md`, replace `{{projectName}}` with project name and `{{runCommand}}` with the correct exec command (`npx`/`pnpm exec`/`yarn`/`bunx`)
  - Run install command (`npm install` / `pnpm install` / `yarn` / `bun install`)
  - Run setup command (`npx libretto setup` / `pnpm exec libretto setup` / etc.)
  - Print success message with next steps (cd, dev command, run command)
- [x] Update `packages/create-libretto/package.json` `files` field to include `template/**`
- [x] Verify `npm create libretto test-project` in a temp directory creates the correct file structure
- [x] Verify the generated `package.json` has the correct project name and libretto version
- [x] Verify `.gitignore` exists (not `_gitignore`)
- [x] Verify `package.json.template` is NOT present in the output directory

### Phase 3: Add create-libretto tests — SKIPPED

Intentionally skipped. The scaffolder logic is straightforward (`readFileSync` → `replaceAll` → `writeFileSync`) and the real failure modes (templates missing from published package, install/setup failures in real environments, OS path edge cases) aren't testable with unit tests using `skipInstall: true`. Not worth the maintenance cost.

### Phase 4: Add "Manual setup" docs page for existing repos

Add a Mintlify page explaining how to add Libretto to an existing project without the scaffolder, and update the introduction page to reference both flows.

- [x] Create `docs/get-started/manual-setup.mdx` covering:
  - Install libretto: `npm install libretto`
  - Run setup: `npx libretto setup`
  - Create a workflow file with `import { workflow } from "libretto"` and `export default workflow(...)`
  - Run it: `npx libretto run ./path/to/workflow.ts`
  - Mention the `src/index.ts` re-export pattern for deploy
- [x] Add `"get-started/manual-setup"` to `docs/docs.json` navigation under "Get started" group, after "introduction"
- [x] Update `docs/get-started/introduction.mdx` to add a brief note after the setup section: "Already have a project? See [Manual setup](./manual-setup) to add Libretto to an existing repo."
- [x] Verify docs build: `cd docs && npx @mintlify/cli validate` passes without errors

### Phase 5: Update introduction docs to reflect new create flow

The introduction page currently says `npm init libretto@latest` runs in the current directory. Update it to reflect the new scaffolding behavior (creates a new directory).

- [ ] Update `docs/get-started/introduction.mdx` setup section to show `npm init libretto@latest my-project` with a project name argument
- [ ] Update the description below it to mention the scaffolded files (package.json, example workflow, tsconfig)
- [ ] Add the package manager alternatives: `pnpm create libretto my-project`, `yarn create libretto my-project`, `bunx create-libretto my-project`
- [ ] Verify the intro page renders correctly with `cd docs && npx @mintlify/cli dev`
