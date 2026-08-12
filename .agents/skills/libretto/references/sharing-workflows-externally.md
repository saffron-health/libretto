# Sharing workflows externally

Share a deployed workflow outside the workspace from the Libretto website dashboard. Workflows stay private until someone shares them there.

Docs: [Sharing workflows externally](https://libretto.sh/docs/libretto-cloud-hosting/sharing-workflows-externally)

## Options

| Option | What others get | Source visible? |
| --- | --- | --- |
| Open workflows | Source they can fork or import as their own Cloud deployment | Yes |
| Hosted workflows | A public run API. Callers use their own API key and credentials | No |

Workspace code sharing must be on in organization settings before either option is available. The dashboard prompts if it is off.

## Share from the dashboard

1. Sign in at [libretto.sh](https://libretto.sh) and open the workspace dashboard.
2. Deploy the workflow so it is ready in Cloud.
3. Open the workflow and expand Share workflow outside this workspace.
4. Choose one:
   - Publish open source workflow — lists source on [Open Source Workflows](https://libretto.sh/open-workflows)
   - Host workflow — lists a run API on [Hosted Workflow APIs](https://libretto.sh/hosted-workflows)
5. If the UI asks to enable sharing, turn it on in [Settings](https://libretto.sh/dashboard/settings), then confirm.

The same workflow can use both options when both source listing and a public run API are wanted.

## What stays private

- Credentials and secret values
- Organization run history and job logs
- Workflow source on hosted listings (callers see schemas and how to call the run API, not the code)
