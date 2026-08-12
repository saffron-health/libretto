# Public workflow sharing and hosting

External public sharing is human-only through the Libretto website dashboard. Agents must not publish workflows externally.

## Terms

- Private deploy: `libretto cloud deploy` plus private runs via `POST /v1/jobs/create`. Normal path for the user's own use.
- Open workflows: public source for fork/import at `/open-workflows/...`. Created in the website UI.
- Hosted workflows: public opaque run API with no source at `/hosted-workflows/...`. Created in the website UI.

"Publish" alone means private deploy. It does not mean share source or host a public opaque API unless the user clearly asks for that.

## Do not share or host from an agent

Never call host/unhost or share/unshare APIs, and never use CLI commands for external publishing (there is no supported `libretto cloud host`, `unhost`, `share`, or `unshare`). Do not enable workspace code sharing from the CLI on the user's behalf.

If the user wants an open workflow or a hosted public run API, explain the distinction and tell them to finish it in the Libretto website dashboard. Point them at [Sharing workflows externally](https://libretto.sh/docs/libretto-cloud-hosting/sharing-workflows-externally). Deploy privately if they still need a ready Cloud workflow.

## If they ask you to publish externally anyway

Refuse the public share or host step. Offer private deploy and a short explanation that external listing is UI-only. Do not invent CLI or API recipes for publishing.
