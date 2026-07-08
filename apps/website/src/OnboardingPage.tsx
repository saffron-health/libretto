import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSafeReturnTo, postAuthRedirect, sanitizeReturnToForAuthState } from "./authRedirect";
import { Navbar } from "./components/Navbar";
import { getAuthStatus, orpcCall } from "./cloudApi";

type OrgCreateResponse = {
  organizationId: string;
  organizationSlug: string;
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

export function OnboardingPage() {
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [debugNotificationEmail, setDebugNotificationEmail] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        if (!status.emailVerified) {
          window.location.assign("/verify-email");
          return;
        }
        if (status.hasTenant) {
          window.location.assign(
            postAuthRedirect({
              emailVerified: status.emailVerified,
              hasTenant: status.hasTenant,
              returnTo: getSafeReturnTo(),
            }),
          );
          return;
        }
        setEmail(status.email);
        setDebugNotificationEmail(status.email);
        setChecking(false);
      })
      .catch(() => {
        window.location.assign("/signin");
      });
  }, []);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const normalizedSlug = slugify(organizationSlug || organizationName);
    if (normalizedSlug.length < 2) {
      setError("Organization slug must be at least 2 characters.");
      setLoading(false);
      return;
    }

    try {
      await orpcCall<OrgCreateResponse>("/v1/auth/createOrgForCurrentUser", {
        organizationName,
        organizationSlug: normalizedSlug,
        debugNotificationEmail: debugNotificationEmail || email,
      });
      window.location.assign(
        sanitizeReturnToForAuthState(getSafeReturnTo(), false) ?? "/setup",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization setup failed.");
      setLoading(false);
    }
  }

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
              Set up your workspace.
            </h1>
            <p className="mt-6 max-w-[500px] text-sm leading-6 text-muted">
              Create the organization that will own hosted jobs, users, billing,
              credentials, and deployments.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {checking ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking account...
              </div>
            ) : (
              <form className="space-y-4" onSubmit={createOrganization}>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Organization
                  </span>
                  <input
                    type="text"
                    value={organizationName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setOrganizationName(next);
                      if (!slugEdited) setOrganizationSlug(slugify(next));
                    }}
                    autoComplete="organization"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Organization slug
                  </span>
                  <input
                    type="text"
                    value={organizationSlug}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setOrganizationSlug(slugify(event.target.value));
                    }}
                    minLength={2}
                    maxLength={60}
                    pattern="[a-z0-9](?:(?:[a-z0-9]|-)*[a-z0-9])?"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Alert email
                  </span>
                  <input
                    type="email"
                    value={debugNotificationEmail}
                    onChange={(event) => setDebugNotificationEmail(event.target.value)}
                    placeholder={email || "ops@example.com"}
                    autoComplete="email"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Creating workspace..." : "Create workspace"}
                </button>
              </form>
            )}

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
