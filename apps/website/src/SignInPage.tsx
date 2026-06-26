import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { authPost, getAuthStatus, getCloudSession } from "./cloudApi";

type AuthResponse = {
  redirect?: boolean;
  url?: string;
};

type AuthMode = "signin" | "signup";

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

export function SignInPage() {
  const [mode, setMode] = useState<AuthMode>(() =>
    new URLSearchParams(window.location.search).get("mode") === "signup"
      ? "signup"
      : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"google" | "email" | "signup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCloudSession()
      .then((session) => {
        if (!session) return;
        getAuthStatus()
          .then((status) => {
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
    try {
      const result = await authPost<AuthResponse>("/api/auth/sign-in/email", {
        email,
        password,
        callbackURL: `${window.location.origin}/dashboard`,
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
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
    try {
      await authPost<AuthResponse>("/api/auth/sign-up/email", {
        name,
        email,
        password,
        callbackURL: `${window.location.origin}/onboarding`,
      });
      window.location.assign("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
      setLoading(null);
    }
  }

  async function continueWithGoogle() {
    setLoading("google");
    setError(null);
    try {
      const result = await authPost<AuthResponse>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: `${window.location.origin}/${mode === "signup" ? "onboarding" : "dashboard"}`,
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      window.location.assign(mode === "signup" ? "/onboarding" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google authentication failed.");
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
                <span className="mb-2 block text-xs uppercase text-muted">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={mode === "signup" ? 8 : undefined}
                  required
                  className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                />
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
          </div>
        </section>
      </main>
    </div>
  );
}
