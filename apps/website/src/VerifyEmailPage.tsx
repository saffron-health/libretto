import { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { getAuthStatus, orpcCall } from "./cloudApi";
import { redirectAfterVerifiedEmail } from "./verifyEmailFlow";

type CliLoginParams = {
  requestId: string;
  secret: string;
};

function getCliLoginParams(): CliLoginParams | null {
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("cliLoginId")?.trim();
  const secret = params.get("cliLoginSecret")?.trim();
  if (!requestId || !secret) return null;
  return { requestId, secret };
}

function getSafeReturnTo(): string | null {
  const rawReturnTo = new URLSearchParams(window.location.search).get("returnTo");
  if (!rawReturnTo) return null;
  try {
    const parsed = new URL(rawReturnTo, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

async function approveCliLoginIfPresent(): Promise<boolean> {
  const cliLogin = getCliLoginParams();
  if (!cliLogin) return false;
  const result = await orpcCall<{ status: "approved" | "pending_verification" }>(
    "/v1/auth/cliLoginApprove",
    {
      requestId: cliLogin.requestId,
      secret: cliLogin.secret,
    },
  );
  return result.status === "approved";
}

export function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    async function checkVerification() {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (status.emailVerified) {
          const redirectTo = await redirectAfterVerifiedEmail({
            hasTenant: status.hasTenant,
            returnTo: getSafeReturnTo(),
            hasCliLoginParams: Boolean(getCliLoginParams()),
            approveCliLogin: approveCliLoginIfPresent,
          });
          if (cancelled) return;
          if (!redirectTo) {
            setEmail(status.email);
            setChecking(false);
            setError(
              "Email verified, but CLI login approval failed. Keep this page open and run `libretto cloud auth login` again.",
            );
            return;
          }
          window.location.assign(redirectTo);
          return;
        }
        setEmail(status.email);
        setError(null);
        setChecking(false);
      } catch {
        if (cancelled) return;
        window.location.assign("/signin");
      }
    }

    void checkVerification();
    intervalId = window.setInterval(checkVerification, 3000);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[980px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_420px] md:items-center">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Libretto Cloud
            </p>
            <h1 className="crt-glow max-w-[560px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[58px]">
              Verify your email.
            </h1>
            <p className="mt-6 max-w-[500px] text-sm leading-6 text-muted">
              Check your inbox before creating a workspace, issuing API keys,
              or approving CLI authentication.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {checking ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking verification...
              </div>
            ) : (
              <>
                <div className="rounded-md border border-rule bg-bg/70 p-5 text-sm leading-6 text-muted">
                  <p>
                    We sent a verification link to{" "}
                    <span className="font-mono text-ink">{email}</span>.
                  </p>
                  <p className="mt-3">
                    Click the link in your inbox to continue. This page will
                    update automatically once your email is verified.
                  </p>
                  <p className="mt-3">
                    Open the verification link in this same browser so Libretto
                    can finish signing you in.
                  </p>
                </div>
                {error && (
                  <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
