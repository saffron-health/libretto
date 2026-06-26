import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { authPost, getAuthStatus, getCloudSession, orpcCall } from "./cloudApi";

type AuthResponse = {
  redirect?: boolean;
  url?: string;
};

type AuthMode = "signin" | "signup";

type PasswordResetResponse = {
  status: "sent" | "not_found";
};

type CliLoginParams = {
  requestId: string;
  secret: string;
};

type CliLoginApproveResponse = {
  status: "approved" | "pending_verification";
  email: string;
};

function getCliLoginParams(): CliLoginParams | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("cliLoginId")?.trim();
  const secret = params.get("cliLoginSecret")?.trim();
  if (!requestId || !secret) return null;
  return { requestId, secret };
}

function withoutCliLoginParams(): string {
  if (typeof window === "undefined") return "/signin";
  const url = new URL(window.location.href);
  url.searchParams.delete("cliLoginId");
  url.searchParams.delete("cliLoginSecret");
  return `${url.pathname}${url.search}${url.hash}`;
}

function currentSigninCallbackUrl(): string {
  const origin =
    typeof window === "undefined" ? "https://libretto.sh" : window.location.origin;
  const url = new URL("/verify-email", origin);
  const cliLogin = getCliLoginParams();
  if (cliLogin) {
    url.searchParams.set("cliLoginId", cliLogin.requestId);
    url.searchParams.set("cliLoginSecret", cliLogin.secret);
  }
  return url.toString();
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[17px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SignInPage() {
  const [mode, setMode] = useState<AuthMode>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mode") === "signup"
      ? "signup"
      : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<"google" | "email" | "signup" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function approveCliLogin(): Promise<boolean> {
    const cliLogin = getCliLoginParams();
    if (!cliLogin) return false;

    const statusBeforeApproval = await getAuthStatus();
    if (!statusBeforeApproval.emailVerified) {
      window.history.replaceState(null, "", currentSigninCallbackUrl());
      window.location.assign(currentSigninCallbackUrl());
      return true;
    }

    const result = await orpcCall<CliLoginApproveResponse>(
      "/v1/auth/cliLoginApprove",
      {
        requestId: cliLogin.requestId,
        secret: cliLogin.secret,
      },
    );
    if (result.status === "pending_verification") {
      window.history.replaceState(null, "", currentSigninCallbackUrl());
      window.location.assign(currentSigninCallbackUrl());
      return true;
    }
    window.history.replaceState(null, "", withoutCliLoginParams());
    try {
      window.location.assign(
        statusBeforeApproval.hasTenant ? "/dashboard" : "/onboarding",
      );
    } catch {
      window.location.assign("/onboarding");
    }
    return true;
  }

  useEffect(() => {
    getCloudSession()
      .then((session) => {
        if (!session) return;
        if (getCliLoginParams()) {
          approveCliLogin().catch((err) => {
            setError(err instanceof Error ? err.message : "CLI login approval failed.");
          });
          return;
        }
        getAuthStatus()
          .then((status) => {
            if (!status.emailVerified) {
              window.location.assign("/verify-email");
              return;
            }
            window.location.assign(status.hasTenant ? "/dashboard" : "/onboarding");
          })
          .catch(() => {
            window.location.assign("/onboarding");
          });
      })
      .catch(() => {});
  }, []);

  async function signInWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("email");
    setError(null);
    setNotice(null);
    try {
      const result = await authPost<AuthResponse>("/api/auth/sign-in/email", {
        email,
        password,
        callbackURL: getCliLoginParams()
          ? currentSigninCallbackUrl()
          : `${window.location.origin}/dashboard`,
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      if (await approveCliLogin()) return;
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email sign-in failed.");
      setLoading(null);
    }
  }

  async function signUpWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("signup");
    setError(null);
    setNotice(null);
    try {
      await authPost<AuthResponse>("/api/auth/sign-up/email", {
        name,
        email,
        password,
        callbackURL: getCliLoginParams()
          ? currentSigninCallbackUrl()
          : `${window.location.origin}/verify-email`,
      });
      if (await approveCliLogin()) return;
      window.location.assign("/verify-email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
      setLoading(null);
    }
  }

  async function continueWithGoogle() {
    setLoading("google");
    setError(null);
    setNotice(null);
    try {
      const result = await authPost<AuthResponse>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: getCliLoginParams()
          ? currentSigninCallbackUrl()
          : `${window.location.origin}/${mode === "signup" ? "onboarding" : "dashboard"}`,
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      if (await approveCliLogin()) return;
      window.location.assign(mode === "signup" ? "/onboarding" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google authentication failed.");
      setLoading(null);
    }
  }

  async function requestPasswordReset() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("Enter your email address to reset your password.");
      setNotice(null);
      return;
    }

    setLoading("reset");
    setError(null);
    setNotice(null);
    try {
      const result = await orpcCall<PasswordResetResponse>(
        "/v1/auth/requestPasswordReset",
        { email: normalizedEmail },
      );
      if (result.status === "not_found") {
        setError(`No Libretto account exists for ${normalizedEmail}.`);
        return;
      }
      setNotice(`Password reset email sent to ${normalizedEmail}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[1080px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_440px] md:items-center">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Libretto Cloud
            </p>
            <h1 className="crt-glow max-w-[620px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[64px]">
              {mode === "signin" ? "Sign in to your hosted workflows." : "Create your hosted workflow account."}
            </h1>
            <p className="mt-6 max-w-[520px] text-sm leading-6 text-muted">
              Review jobs, manage teammates, and update billing from the same
              account used by the Libretto CLI.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            <div className="mb-5 grid grid-cols-2 rounded-lg border border-rule bg-bg p-1">
              {(["signin", "signup"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setError(null);
                    setNotice(null);
                  }}
                  className="h-9 rounded-md text-xs font-medium uppercase text-muted transition-colors hover:text-ink aria-pressed:bg-panel-hi aria-pressed:text-accent-bright"
                  aria-pressed={mode === option}
                >
                  {option === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={loading !== null}
              className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-rule bg-bg/70 px-4 text-sm font-medium text-ink shadow-sm shadow-black/20 transition-colors hover:border-accent/45 hover:bg-panel-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="grid size-6 place-items-center rounded-full bg-ink">
                <GoogleLogo />
              </span>
              {loading === "google"
                ? "Opening Google..."
                : mode === "signin" ? "Continue with Google" : "Sign up with Google"}
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-rule" />
              <span className="text-xs uppercase text-muted/70">or</span>
              <div className="h-px flex-1 bg-rule" />
            </div>

            <form
              className="space-y-4"
              onSubmit={mode === "signin" ? signInWithEmail : signUpWithEmail}
            >
              {mode === "signup" && (
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-xs uppercase text-muted">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-2 flex items-center justify-between gap-3 text-xs uppercase text-muted">
                  <span>Password</span>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={requestPasswordReset}
                      disabled={loading !== null}
                      className="text-[11px] text-accent transition-colors hover:text-accent-bright disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading === "reset" ? "Sending..." : "Forgot password?"}
                    </button>
                  )}
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    minLength={mode === "signup" ? 8 : undefined}
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 pr-12 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1 top-1 grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-panel-hi hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                  >
                    <EyeIcon />
                  </button>
                </div>
              </label>
              <button
                type="submit"
                disabled={loading !== null}
                className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mode === "signin"
                  ? loading === "email" ? "Signing in..." : "Sign in"
                  : loading === "signup" ? "Creating account..." : "Create account"}
              </button>
            </form>

            {error && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                {error}
              </p>
            )}
            {notice && (
              <p className="mt-4 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm leading-5 text-accent-bright">
                {notice}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
