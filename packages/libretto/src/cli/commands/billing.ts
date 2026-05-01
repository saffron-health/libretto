/**
 * Hosted-platform billing commands. Stripe is the source of truth
 * for the plan catalog and is also where every tenant — including
 * Free — has a live Subscription. The Stripe Customer Portal is the
 * single management UI: it shows the user's current plan and lets
 * them switch between any of the configured Subscription Update
 * products (Free / Pro / Team).
 *
 *   npx libretto experimental billing portal   → Stripe Customer Portal
 *   npx libretto experimental billing status   → plan + usage + period end
 *
 * `libretto init` is unchanged. New tenants start on Free automatically
 * (with a real Stripe Customer + Free Subscription created at signup).
 *
 * Auth: requires a session cookie (or LIBRETTO_API_KEY).
 */

import { SimpleCLI } from "../framework/simple-cli.js";
import {
  NOT_AUTHENTICATED_MESSAGE,
  orpcCall,
  pickCredential,
  resolveApiUrl,
} from "../core/auth-fetch.js";
import { readAuthState } from "../core/auth-storage.js";

// Marketing-site URL — used for BAA requests and Enterprise contact.
const CONTACT_URL = "https://libretto.sh";

// ---------------------------------------------------------------------------
// Types — mirrored from api/src/routes/billing/subscription.ts
// ---------------------------------------------------------------------------

type SubscriptionResponse = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  browserHoursUsedThisPeriod: number;
  browserHoursLimit: number | null;
};

type OpenPlansPageResponse = {
  url: string;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireAuth(): Promise<{ apiUrl: string; credential: ReturnType<typeof pickCredential> }> {
  const stored = await readAuthState();
  const apiUrl = resolveApiUrl(stored);
  const credential = pickCredential(stored);
  if (credential.source === "none") {
    throw new Error(NOT_AUTHENTICATED_MESSAGE);
  }
  return { apiUrl, credential };
}

function formatLimit(limit: number | null): string {
  return limit === null ? "∞" : String(limit);
}

// ---------------------------------------------------------------------------
// portal: always opens the Stripe Customer Portal — every tenant has a
// live Stripe Subscription (Free or paid) so the portal always has
// something to show. It's where users see their current plan and switch
// to another. We DON'T branch on plan / status here.
// ---------------------------------------------------------------------------

export const billingPortalCommand = SimpleCLI.command({
  description: "Open the libretto plans page (current plan + switch options)",
  experimental: true,
})
  .handle(async () => {
    const { apiUrl, credential } = await requireAuth();
    const { url } = await orpcCall<OpenPlansPageResponse>({
      apiUrl,
      path: "/v1/billing/openPlansPage",
      credential,
    });
    console.log("Open this URL in your browser to choose or change your plan:");
    console.log(`  ${url}`);
    console.log();
    console.log(
      "(Shows all tiers with features, your current plan, and a Manage payment / invoices link.)",
    );
    console.log(
      `For a BAA or Enterprise pricing, contact us at ${CONTACT_URL}.`,
    );
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export const billingStatusCommand = SimpleCLI.command({
  description: "Print the current plan, status, and browser-hour usage",
  experimental: true,
})
  .handle(async () => {
    const { apiUrl, credential } = await requireAuth();
    const sub = await orpcCall<SubscriptionResponse>({
      apiUrl,
      path: "/v1/billing/subscription",
      credential,
    });

    const used = sub.browserHoursUsedThisPeriod.toFixed(2);
    const limit = formatLimit(sub.browserHoursLimit);

    console.log(`Plan:    ${sub.plan} (${sub.status})`);
    console.log(`Usage:   ${used} / ${limit} browser hours this period`);
    if (sub.currentPeriodEnd) {
      console.log(`Period:  ends ${sub.currentPeriodEnd.slice(0, 10)}`);
    }
    if (sub.cancelAtPeriodEnd) {
      console.log("Note:    cancellation scheduled at period end.");
    }
  });

// ---------------------------------------------------------------------------
// Group export
// ---------------------------------------------------------------------------

export const billingCommands = SimpleCLI.group({
  description: "Hosted-platform subscription + usage commands",
  routes: {
    portal: billingPortalCommand,
    status: billingStatusCommand,
  },
});
