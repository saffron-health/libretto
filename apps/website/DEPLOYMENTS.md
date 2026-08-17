# Website deployments

The website uses one Vercel project with two deployment targets:

| Target | Domain | API | Trigger |
|---|---|---|---|
| Staging | `staging.libretto.sh` | `https://api.staging.libretto.sh` | Vercel branch rule for `main` |
| Production | `libretto.sh` | `https://api.libretto.sh` | Manual GitHub workflow |

Vercel's custom `staging` environment owns the `main` branch rule. The
Production Branch is a protected release branch, not `main`, so merging `main`
cannot deploy Production. The production GitHub workflow deploys the selected
`main` commit manually. `vercel.json` disables Git deployments for every other
branch, so the old PR previews are not part of this staging setup.

## One-time setup

1. In Vercel Project Settings, create a custom environment named `staging`.
   Add a branch rule matching exactly `main`.
2. Change the project's Production Branch from `main` to a protected branch
   named `production`. `vercel.json` explicitly disables Git deployments for
   that branch, so even an accidental push cannot bypass the manual workflow.
3. Attach `staging.libretto.sh` to the staging environment and add the DNS record
   Vercel requests.
4. Enable Standard Deployment Protection with Vercel Authentication for
   pre-production deployments. Grant project access only to Libretto team
   members, do not create shareable-link bypasses, and verify the staging URL
   while signed out.
5. In Vercel's Environment Variables settings, enable **Automatically expose
   System Environment Variables** so the build receives `VERCEL_TARGET_ENV`.
   The build fails if its target and endpoint identities do not agree.
6. In Vercel, set `VITE_LIBRETTO_CLOUD_API_URL` and
   `VITE_GITHUB_APP_INSTALL_URL` separately for the staging and Production
   environments. Staging uses `https://api.staging.libretto.sh` and the
   separate staging GitHub App installation URL. Production uses
   `https://api.libretto.sh` and
   `https://github.com/apps/libretto-agent/installations/new`. The build
   validates these values
   against `VERCEL_TARGET_ENV` and stops rather than falling back to the wrong
   API or GitHub App.
7. In GitHub, create a `production` environment and require an approver. Add
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as its secrets. The
   token and project id identify the existing production website project; no
   Vercel token is exposed to the automatic staging build.
8. Finish the staging API domain and OAuth setup documented in
   `saffron-health/libretto-cloud/terraform/README.md` before the first staging
   website deployment.

The staging target receives its API URL from the Vercel environment. The
manual production workflow also passes the production values explicitly, so a
manual release does not depend on a generated hostname or inherited staging
configuration.

Run `Deploy Website to Production` from the Actions tab on the `main` branch
to release the current `main` commit to `libretto.sh`.
