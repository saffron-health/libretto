import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getSafeReturnTo,
  postAuthRedirect,
  withReturnTo,
} from "./authRedirect";
import { Navbar } from "./components/Navbar";
import {
  getAuthStatus,
  getCloudSession,
  orpcCall,
} from "./cloudApi";

type CliLoginApproveResponse = {
  status: "approved" | "pending_verification";
  email: string;
};

function currentOrigin(): string {
  return typeof window === "undefined"
    ? "https://libretto.sh"
    : window.location.origin;
}

function currentSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function prefilledUserCode(): string {
  return currentSearchParams().get("user_code")?.trim() ?? "";
}

function deviceReturnTo(userCode: string): string {
  const url = new URL("/device", currentOrigin());
  if (userCode) url.searchParams.set("user_code", userCode);
  const mode = currentSearchParams().get("mode")?.trim();
  if (mode === "signup") url.searchParams.set("mode", "signup");
  return `${url.pathname}${url.search}`;
}

function signInHref(userCode: string): string {
  const returnTo = deviceReturnTo(userCode);
  const url = new URL("/signin", currentOrigin());
  url.searchParams.set("returnTo", returnTo);
  if (currentSearchParams().get("mode")?.trim() === "signup") {
    url.searchParams.set("mode", "signup");
  }
  return `${url.pathname}${url.search}`;
}

export function DevicePage() {
  const [userCode, setUserCode] = useState(prefilledUserCode);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCloudSession()
      .then((session) => {
        if (!session) {
          window.location.assign(signInHref(prefilledUserCode()));
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        window.location.assign(signInHref(prefilledUserCode()));
      });
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = userCode.trim();
    if (!normalized) {
      setError("Enter the code shown in your terminal.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await orpcCall<CliLoginApproveResponse>(
        "/v1/auth/cliLoginApprove",
        { userCode: normalized },
      );
      if (result.status === "pending_verification") {
        window.location.assign(
          withReturnTo("/verify-email", deviceReturnTo(normalized)),
        );
        return;
      }
      window.location.assign(
        postAuthRedirect({
          ...(await getAuthStatus()),
          returnTo: getSafeReturnTo(),
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not approve this code. Check the terminal and try again.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[1080px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_440px] md:items-center">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Libretto
            </p>
            <h1 className="crt-glow max-w-[620px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[64px]">
              Approve this CLI sign-in.
            </h1>
            <p className="mt-6 max-w-[520px] text-sm leading-6 text-muted">
              Enter the one-time code from your terminal. Continue only if you
              started this login in the Libretto CLI.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {checkingSession ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking your session...
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(event) => void confirm(event)}>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    One-time code
                  </span>
                  <input
                    type="text"
                    value={userCode}
                    onChange={(event) => setUserCode(event.target.value.toUpperCase())}
                    autoComplete="one-time-code"
                    spellCheck={false}
                    placeholder="WDJB-MJHT"
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 font-mono text-sm tracking-[0.2em] text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Approving..." : "Confirm"}
                </button>
                {error && (
                  <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                    {error}
                  </p>
                )}
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
