# Public Workflow Sharing (Open workflows)

Before running `libretto cloud share <workflow>`, review the complete local workflow source and every local module it imports for information that must not become public. Check `package.json` as well.

Look for hardcoded secrets, authentication material, private keys, payment-card data, personal information, private URLs, account identifiers, addresses, email addresses, and phone numbers. Make sure this reviewed source is the version deployed for that workflow; if it has changed since deployment, deploy the reviewed version before sharing.

Values read from workflow parameters or declared Libretto credentials are not part of the published source values and do not need to be removed. Hardcoded sensitive values do. If you find any, refuse to share the workflow, identify each file and line without repeating the sensitive value, and offer to replace it with a workflow parameter or named Libretto credential. Run `libretto cloud share` only after the local review is clean.

`libretto cloud share` publishes **Open workflows** — public source-sharing listings at `/open-workflows/...` (plus a plain-text `/code` URL). That is different from **hosted workflows**, which expose an opaque run API without sharing source.

The CLI publishes directly after this local review; Libretto Cloud does not repeat it. Chrome extension shares explicitly request a cloud privacy review before publication because extension users cannot inspect the generated source directly.
