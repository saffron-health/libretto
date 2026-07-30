import { postAuthRedirect } from "./authRedirect";

export async function redirectAfterVerifiedEmail(input: {
  hasTenant: boolean;
  returnTo: string | null;
  hasCliLoginParams: boolean;
  approveCliLogin: () => Promise<boolean>;
  getHasTenantAfterApproval?: () => Promise<boolean>;
}): Promise<string | null> {
  let hasTenant = input.hasTenant;
  if (input.hasCliLoginParams) {
    const approved = await input.approveCliLogin().catch(() => false);
    if (!approved) return null;
    if (input.getHasTenantAfterApproval) {
      hasTenant = await input.getHasTenantAfterApproval();
    }
  }

  return postAuthRedirect({
    emailVerified: true,
    hasTenant,
    returnTo: input.returnTo,
  });
}
