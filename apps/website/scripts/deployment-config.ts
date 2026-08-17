const PRODUCTION_API_URL = "https://api.libretto.sh";
const STAGING_API_URL = "https://api.staging.libretto.sh";
const PRODUCTION_GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/libretto-agent/installations/new";

type DeploymentConfig = {
  target?: string;
  apiUrl?: string;
  githubAppInstallUrl?: string;
};

export function validateVercelDeploymentConfig({
  target,
  apiUrl,
  githubAppInstallUrl,
}: DeploymentConfig): void {
  if (!target) {
    if (apiUrl || githubAppInstallUrl) {
      throw new Error(
        "A Vercel deployment target is required when deployment URLs are configured.",
      );
    }
    return;
  }

  if (target === "production") {
    if (apiUrl !== PRODUCTION_API_URL) {
      throw new Error(
        `Production builds require VITE_LIBRETTO_CLOUD_API_URL=${PRODUCTION_API_URL}`,
      );
    }
    if (githubAppInstallUrl !== PRODUCTION_GITHUB_APP_INSTALL_URL) {
      throw new Error(
        "Production builds require the production GitHub App install URL.",
      );
    }
    return;
  }

  if (target === "staging") {
    if (apiUrl !== STAGING_API_URL) {
      throw new Error(
        `Staging builds require VITE_LIBRETTO_CLOUD_API_URL=${STAGING_API_URL}`,
      );
    }
    if (
      !githubAppInstallUrl ||
      githubAppInstallUrl === PRODUCTION_GITHUB_APP_INSTALL_URL ||
      !/^https:\/\/github\.com\/apps\/[a-z0-9-]+\/installations\/new$/.test(
        githubAppInstallUrl,
      )
    ) {
      throw new Error(
        "Staging builds require a separate staging GitHub App install URL.",
      );
    }
    return;
  }

  throw new Error(`Unsupported Vercel deployment target: ${target}`);
}
