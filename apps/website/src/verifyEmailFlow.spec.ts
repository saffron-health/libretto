import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectAfterVerifiedEmail } from "./verifyEmailFlow";

describe("redirectAfterVerifiedEmail", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { origin: "https://libretto.sh" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for CLI login approval before returning the redirect target", async () => {
    let approve!: (value: boolean) => void;
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve;
    });
    const approveCliLogin = vi.fn(() => approval);

    const redirectPromise = redirectAfterVerifiedEmail({
      hasTenant: true,
      returnTo: null,
      hasCliLoginParams: true,
      approveCliLogin,
    });

    let settled = false;
    redirectPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(approveCliLogin).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    approve(true);

    await expect(redirectPromise).resolves.toBe("/dashboard");
  });

  it("does not redirect when CLI login approval fails", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: true,
        returnTo: "/invite?accept=1",
        hasCliLoginParams: true,
        approveCliLogin: async () => false,
      }),
    ).resolves.toBeNull();
  });

  it("does not redirect when CLI login approval throws", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: true,
        returnTo: "/dashboard",
        hasCliLoginParams: true,
        approveCliLogin: async () => {
          throw new Error("approval failed");
        },
      }),
    ).resolves.toBeNull();
  });

  it("redirects immediately when there is no CLI login to approve", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: false,
        returnTo: null,
        hasCliLoginParams: false,
        approveCliLogin: async () => {
          throw new Error("should not be called");
        },
      }),
    ).resolves.toBe("/onboarding");
  });

  it("sends an existing tenant to the dashboard after email verification", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: true,
        returnTo: null,
        hasCliLoginParams: false,
        approveCliLogin: async () => true,
      }),
    ).resolves.toBe("/dashboard");
  });

  it("preserves dashboard return targets for an existing tenant", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: true,
        returnTo: "/dashboard/cloud-browsers",
        hasCliLoginParams: false,
        approveCliLogin: async () => true,
      }),
    ).resolves.toBe("/dashboard/cloud-browsers");
  });

  it("drops dashboard return targets before a tenant exists", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: false,
        returnTo: "/dashboard",
        hasCliLoginParams: false,
        approveCliLogin: async () => true,
      }),
    ).resolves.toBe("/onboarding");
  });

  it("preserves GitHub return targets through organization creation", async () => {
    await expect(
      redirectAfterVerifiedEmail({
        hasTenant: false,
        returnTo: "/github/setup?installation_id=123&setup_action=install",
        hasCliLoginParams: false,
        approveCliLogin: async () => true,
      }),
    ).resolves.toBe(
      "/onboarding?returnTo=%2Fgithub%2Fsetup%3Finstallation_id%3D123%26setup_action%3Dinstall",
    );
  });
});
