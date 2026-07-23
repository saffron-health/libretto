import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navbar } from "./components/Navbar";
import { getAuthStatus, orpcCall } from "./cloudApi";

type OrgCreateResponse = {
  organizationId: string;
  organizationSlug: string;
};

type Product = "chrome-extension" | "cloud-browsers" | "pr-agent";

function initialProduct(): Product | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("product");
  if (value === "developer") return "cloud-browsers";
  return value === "chrome-extension" ||
    value === "cloud-browsers" ||
    value === "pr-agent"
    ? value
    : null;
}

function dashboardForProduct(product: Product | null): string {
  if (product === "chrome-extension") return "/dashboard/workflows";
  if (product === "cloud-browsers") return "/dashboard/workflow_runs";
  if (product === "pr-agent") return "/dashboard/connected_repos";
  return "/dashboard";
}

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
  const [product, setProduct] = useState<Product | null>(initialProduct);
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
          window.location.assign(dashboardForProduct(initialProduct()));
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

    if (!product) {
      setError("Choose how you want to use Libretto.");
      setLoading(false);
      return;
    }

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
      window.location.assign(dashboardForProduct(product));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Organization setup failed.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="crt-page min-h-screen bg-bg text-ink">
      <Navbar />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[1040px] items-center px-6 py-10">
        <section className="grid w-full gap-10 md:grid-cols-[1fr_420px] md:items-start">
          <div>
            <p className="mb-4 font-mono text-xs uppercase text-accent">
              Welcome to Libretto
            </p>
            <h1 className="crt-glow max-w-[560px] font-serif text-[44px] font-[300] leading-[1.02] text-ink md:text-[58px]">
              What do you want to automate?
            </h1>
            <p className="mt-6 max-w-[500px] text-sm leading-6 text-muted">
              Choose where you want to start. All products use the same Libretto
              account and billing.
            </p>

            <div className="mt-8 grid max-w-[560px] gap-3">
              <button
                type="button"
                onClick={() => {
                  setProduct("chrome-extension");
                  setError(null);
                }}
                aria-pressed={product === "chrome-extension"}
                className="group rounded-lg border border-rule bg-panel/70 p-5 text-left transition-colors hover:border-accent/40 aria-pressed:border-accent aria-pressed:bg-green-3/25"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-medium text-ink">
                    Chrome extension
                  </span>
                  <span className="grid size-5 place-items-center rounded-full border border-rule text-[11px] text-transparent group-aria-pressed:border-accent group-aria-pressed:bg-accent group-aria-pressed:text-bg">
                    ✓
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted">
                  Automate one-time tasks and repeatable work in Chrome. No code
                  required.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProduct("cloud-browsers");
                  setError(null);
                }}
                aria-pressed={product === "cloud-browsers"}
                className="group rounded-lg border border-rule bg-panel/70 p-5 text-left transition-colors hover:border-accent/40 aria-pressed:border-accent aria-pressed:bg-green-3/25"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-medium text-ink">
                    Cloud Browsers
                  </span>
                  <span className="grid size-5 place-items-center rounded-full border border-rule text-[11px] text-transparent group-aria-pressed:border-accent group-aria-pressed:bg-accent group-aria-pressed:text-bg">
                    ✓
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted">
                  Run website workflows in the cloud and manage jobs, sessions,
                  and usage.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProduct("pr-agent");
                  setError(null);
                }}
                aria-pressed={product === "pr-agent"}
                className="group rounded-lg border border-rule bg-panel/70 p-5 text-left transition-colors hover:border-accent/40 aria-pressed:border-accent aria-pressed:bg-green-3/25"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-medium text-ink">
                    Debug Agents
                  </span>
                  <span className="grid size-5 place-items-center rounded-full border border-rule text-[11px] text-transparent group-aria-pressed:border-accent group-aria-pressed:bg-accent group-aria-pressed:text-bg">
                    ✓
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted">
                  Connect Playwright projects and get pull requests when an
                  automation breaks.
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-rule bg-panel/85 p-5 shadow-2xl shadow-black/25">
            {checking ? (
              <div className="rounded-md border border-rule bg-bg/70 px-4 py-8 text-center text-sm text-muted">
                Checking account...
              </div>
            ) : (
              <form className="space-y-4" onSubmit={createOrganization}>
                <div className="border-b border-rule pb-4">
                  <p className="text-base font-medium text-ink">
                    Set up your workspace
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Your workspace keeps your automations, teammates, and
                    billing together.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Workspace name
                  </span>
                  <input
                    type="text"
                    value={organizationName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setOrganizationName(next);
                      if (!slugEdited) setOrganizationSlug(slugify(next));
                    }}
                    placeholder="Acme"
                    autoComplete="organization"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Workspace URL
                  </span>
                  <div className="flex h-10 overflow-hidden rounded-md border border-rule bg-bg transition-colors focus-within:border-accent">
                    <span className="flex items-center border-r border-rule px-3 text-xs text-muted">
                      libretto.sh/
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
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase text-muted">
                    Notification email
                  </span>
                  <input
                    type="email"
                    value={debugNotificationEmail}
                    onChange={(event) =>
                      setDebugNotificationEmail(event.target.value)
                    }
                    placeholder={email || "ops@example.com"}
                    autoComplete="email"
                    required
                    className="h-10 w-full rounded-md border border-rule bg-bg px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/45 focus:border-accent"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading || !product}
                  className="libretto-button libretto-button--default h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? "Creating workspace..."
                    : product
                      ? "Continue"
                      : "Choose a product to continue"}
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
