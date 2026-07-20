import { postAuthRedirect } from "./authRedirect";

export async function redirectAfterVerifiedEmail(input: {
  hasTenant: boolean;
  setupComplete: boolean;
  returnTo: string | null;
  hasCliLoginParams: boolean;
  approveCliLogin: () => Promise<boolean>;
}): Promise<string | null> {
  if (input.hasCliLoginParams) {
    const approved = await input.approveCliLogin().catch(() => false);
    if (!approved) return null;
  }

  return postAuthRedirect({
    emailVerified: true,
    hasTenant: input.hasTenant,
    setupComplete: input.setupComplete,
    returnTo: input.returnTo,
  });
}
