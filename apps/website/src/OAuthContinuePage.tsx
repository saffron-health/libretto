import { useEffect, useState } from "react";
import { withReturnTo } from "./authRedirect";
import { authPost, getAuthStatus } from "./cloudApi";
import { Navbar } from "./components/Navbar";

type AuthResponse = {
  url?: string;
  uri?: string;
};

export function OAuthContinuePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function continueOAuth() {
      const oauthQuery = window.location.search.replace(/^\?/, "");
      const params = new URLSearchParams(oauthQuery);
      if (!params.has("client_id") || !params.has("sig")) {
        setError("The ChatGPT authorization request is missing or invalid. Start again in ChatGPT.");
        return;
      }

      const returnTo = `/oauth/continue?${oauthQuery}`;
      const status = await getAuthStatus();
      if (!status.emailVerified) {
        window.location.assign(withReturnTo("/verify-email", returnTo));
        return;
      }
      if (!status.hasTenant) {
        window.location.assign(withReturnTo("/onboarding", returnTo));
        return;
      }

      const result = await authPost<AuthResponse>("/api/auth/oauth2/continue", {
        postLogin: true,
        oauth_query: oauthQuery,
      });
      const destination = result.uri ?? result.url;
      if (!destination) {
        throw new Error("Libretto did not return a ChatGPT authorization destination.");
      }
      window.location.assign(destination);
    }

    continueOAuth().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not continue ChatGPT authorization.");
    });
  }, []);

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[760px] items-center px-6 py-10">
        <section className="w-full rounded-lg border border-rule bg-panel/85 p-6 text-center shadow-2xl shadow-black/25">
          <p className="mb-3 font-mono text-xs uppercase text-accent">Libretto Cloud</p>
          <h1 className="font-serif text-4xl font-light">Continue to ChatGPT</h1>
          {error ? (
            <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm leading-5 text-red-200">
              {error}
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">
              Checking your account and workspace before showing the access request.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
