import { postAuthRedirect } from "./authRedirect";

export function targetAfterVerification(hasTenant: boolean): string {
  return hasTenant ? "/setup" : "/onboarding";
}

export async function redirectAfterVerifiedEmail(input: {
  hasTenant: boolean;
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
    returnTo: input.returnTo,
  });
}
