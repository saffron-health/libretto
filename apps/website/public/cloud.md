# Set Up Libretto Cloud

Set up an existing Libretto project to use Libretto Cloud hosted browsers.

If Libretto is not installed in this project yet, first fetch and follow https://libretto.sh/start.md.

## 1. Confirm the project

Make sure your current directory is the Libretto package directory. It should contain `package.json` and `.libretto/config.json`.

If `.libretto/config.json` does not exist, run:

```bash
npx libretto setup
```

## 2. Sign in

The user should already have a Libretto account. Sign in from the CLI:

```bash
npx libretto cloud auth login
```

Wait for the browser sign-in flow to complete, then confirm the active identity:

```bash
npx libretto cloud auth whoami
```

## 3. Issue an API key

Create a project API key:

```bash
npx libretto cloud auth api-key issue --label local-dev
```

Store the printed key in the project `.env` file:

```dotenv
LIBRETTO_API_KEY=<issued-key>
```

Do not commit `.env`.

## 4. Use Libretto Cloud as the browser provider

Update `.libretto/config.json` so local runs use the same browser provider as hosted runs:

```json
{
  "version": 1,
  "provider": "libretto-cloud"
}
```

Preserve any existing config fields such as `viewport`, `windowPosition`, or `sessionMode`.

## 5. Ask about webhooks

Ask the user whether this project needs a webhook for job results.

If yes, create or document a webhook endpoint for `job.completed` and `job.failed` events. See https://libretto.sh/docs/libretto-cloud-hosting/overview and https://libretto.sh/docs/libretto-cloud-api/webhooks.

## 6. Deploy

Deploy from the workflow package directory:

```bash
npx libretto cloud deploy .
```

If workflows are exported from a non-default entry file, use `--entry-point` with a path relative to the package directory.

## 7. Finish

Report:

- which Libretto account is signed in
- where `LIBRETTO_API_KEY` was stored
- whether `.libretto/config.json` uses `provider: "libretto-cloud"`
- whether a webhook was configured or deferred
- the deployment id and discovered workflow names
