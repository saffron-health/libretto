import { describe, expect, it } from "vitest";
import { validateVercelDeploymentConfig } from "./deployment-config";

const production = {
  target: "production",
  apiUrl: "https://api.libretto.sh",
  githubAppInstallUrl:
    "https://github.com/apps/libretto-agent/installations/new",
};

const staging = {
  target: "staging",
  apiUrl: "https://api.staging.libretto.sh",
  githubAppInstallUrl:
    "https://github.com/apps/libretto-agent-staging/installations/new",
};

describe("Vercel deployment configuration", () => {
  it("accepts exact production and staging configuration", () => {
    expect(() => validateVercelDeploymentConfig(production)).not.toThrow();
    expect(() => validateVercelDeploymentConfig(staging)).not.toThrow();
  });

  it("rejects a staging build pointed at production", () => {
    expect(() =>
      validateVercelDeploymentConfig({
        ...staging,
        apiUrl: production.apiUrl,
      }),
    ).toThrow(/Staging builds require/);
  });

  it("rejects production credentials in staging", () => {
    expect(() =>
      validateVercelDeploymentConfig({
        ...staging,
        githubAppInstallUrl: production.githubAppInstallUrl,
      }),
    ).toThrow(/separate staging GitHub App/);
  });

  it("rejects missing and unsupported Vercel targets", () => {
    expect(() =>
      validateVercelDeploymentConfig({ target: "preview" }),
    ).toThrow(/Unsupported/);
    expect(() =>
      validateVercelDeploymentConfig({ target: "staging" }),
    ).toThrow(/Staging builds require/);
    expect(() =>
      validateVercelDeploymentConfig({ apiUrl: staging.apiUrl }),
    ).toThrow(/deployment target is required/);
  });

  it("does not constrain local builds", () => {
    expect(() => validateVercelDeploymentConfig({})).not.toThrow();
  });
});
