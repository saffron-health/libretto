import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSafeReturnTo, postAuthRedirect } from "./authRedirect";
import { Navbar } from "./components/Navbar";
import {
  getAuthStatus,
  getSetupStatus,
  isPrAgentSetupComplete,
  orpcCall,
} from "./cloudApi";

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
      .then(async (status) => {
        if (!status.emailVerified) {
          window.location.assign("/verify-email");
          return;
        }
        if (status.hasTenant) {
          const setupComplete = await getSetupStatus()
            .then(isPrAgentSetupComplete)
            .catch(() => false);
          window.location.assign(
            postAuthRedirect({
              emailVerified: status.emailVerified,
              hasTenant: status.hasTenant,
              setupComplete,
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
        postAuthRedirect({
          emailVerified: true,
          hasTenant: true,
          setupComplete: false,
          returnTo: getSafeReturnTo(),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization setup failed.");
      setLoading(false);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-[980px] px-4 py-8 md:px-8">
        <div className="mb-7 border-b border-rule pb-6">
          <p className="mb-2 font-mono text-xs uppercase text-accent">
            Libretto setup
          </p>
          <h1 className="font-serif text-[34px] font-[300] leading-tight md:text-[46px]">
            Set up your workspace
          </h1>
        </div>

        {checking ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel/45 px-4 py-10 text-center text-sm text-muted">
            Checking account...
          </div>
        ) : (
          <section className="rounded-lg border border-accent/25 bg-green-9/10 p-4 md:p-5">
            <form
              className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] md:items-start"
              onSubmit={createOrganization}
            >
              <div className="min-w-0">
                <p className="mb-2 font-mono text-xs uppercase text-accent">
                  Workspace
                </p>
                <h2 className="text-lg font-semibold text-ink">
                  Create your organization
                </h2>
                <p className="mt-2 max-w-[520px] text-sm leading-6 text-muted">
                  This workspace owns users, repositories, and PR agent settings.
                </p>
              </div>

              <div className="space-y-4 rounded-md border border-rule bg-bg/70 p-4">
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
              </div>
            </form>

            {error && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
