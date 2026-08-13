# Sharing workflows externally

Publish a deployed workflow outside the workspace as a hosted API with visible source code. Workflows stay private until someone publishes them.

Docs: [Sharing workflows externally](https://libretto.sh/docs/libretto-cloud-hosting/sharing-workflows-externally)

## What publication includes

Each publication includes a hosted run endpoint, input and output types, required credential names, and source files that others can inspect or adapt.

Libretto reviews the source for sensitive information before it publishes anything. Blocked findings must be fixed; warnings require explicit acknowledgement. Workspace sharing must also be on in organization settings.

## Publish

1. Sign in at [libretto.sh](https://libretto.sh) and open the workspace dashboard.
2. Deploy the workflow so it is ready in Cloud.
3. Open the workflow, expand Share workflow outside this workspace, and select Publish externally.
4. Review any privacy findings. Fix blocked findings or explicitly acknowledge warnings.
5. If sharing is off, enable it in [Settings](https://libretto.sh/dashboard/settings), then publish again.

The CLI uses the same method: `libretto cloud publish <workflow>`. Use `--acknowledge-warnings` only after reviewing the printed findings. Run `libretto cloud unpublish <workflow>` to remove both the API and source.

## What stays private

- Credentials and secret values
- Organization run history and job logs
- Publisher and caller inputs, outputs, logs, and run history
