import { useState, type ReactNode } from "react";
import { Kicker } from "./Kicker";
import { Text } from "./Text";

type ProductKind = "chrome" | "cli" | "cloud" | "repair" | "sdk";
export type AudienceFilter = "all" | "people" | "developers" | "agents";
type ProductAction = "link" | "copy";

interface ProductPath {
  title: string;
  description: string;
  product: string;
  href: string;
  action: string;
  kind: ProductKind;
  audienceFilter: Exclude<AudienceFilter, "all">;
  actionType: ProductAction;
  prompt?: string;
}

const products: ProductPath[] = [
  {
    title: "Have an agent do your work in Chrome.",
    description:
      "Give it a task, then save the result as a repeatable workflow. Run it much faster in the cloud whenever you need it or on a schedule, even when your computer is closed.",
    product: "Chrome Extension",
    href: "/chrome-extension",
    action: "Download for Chrome",
    kind: "chrome",
    audienceFilter: "people",
    actionType: "link",
  },
  {
    title: "Build reliable browser automations with your coding agent.",
    description:
      "Capture the task on the live website, then turn it into deterministic TypeScript that your coding agent can test, debug, and maintain in your codebase.",
    product: "Libretto CLI",
    href: "",
    action: "Copy setup prompt",
    kind: "cli",
    audienceFilter: "developers",
    actionType: "copy",
    prompt:
      "Set up Libretto in this project. Install libretto and zod, run `npx libretto setup`, then create a reliable TypeScript browser workflow for: [describe the browser task]. Use the installed Libretto skill and verify the workflow against the live website.",
  },
  {
    title: "Run browser automations in the cloud.",
    description:
      "Deploy workflows to managed browsers, run them on demand or on a schedule, inspect every run, and automatically recover when websites change. No browser infrastructure to operate.",
    product: "Libretto Cloud Browsers",
    href: "/signin?mode=signup",
    action: "Sign up for Cloud Browsers",
    kind: "cloud",
    audienceFilter: "developers",
    actionType: "link",
  },
  {
    title: "Automatically repair broken Playwright workflows.",
    description:
      "Keep running workflows on your own infrastructure. When a website changes, a debugging agent reproduces the failure, verifies a fix, and opens a pull request.",
    product: "PR Review Agents",
    href: "/signin?mode=signup",
    action: "Sign up for PR Review Agents",
    kind: "repair",
    audienceFilter: "developers",
    actionType: "link",
  },
  {
    title: "Give your agent a browser.",
    description:
      "Add a small, framework-agnostic toolset for opening pages, inspecting browser state, and taking reliable actions with local or cloud browsers.",
    product: "Browser Tools SDK",
    href: "",
    action: "Copy SDK setup prompt",
    kind: "sdk",
    audienceFilter: "agents",
    actionType: "copy",
    prompt:
      "Install libretto-browser-tools with the Vercel AI SDK adapter and LocalBrowserProvider. Wire createAiSdkBrowserTools into a generateText (or ToolLoopAgent) loop, install Playwright Chromium for local sessions, run a short task that opens a page and answers a question about it, and always call dispose() when the loop ends.",
  },
];

const productGroups: Record<
  Exclude<AudienceFilter, "all">,
  { label: string; description: string }
> = {
  people: {
    label: "No-code tools",
    description: "Automate browser work without writing code.",
  },
  developers: {
    label: "Developer tools",
    description: "Build, host, and repair reliable browser automations.",
  },
  agents: {
    label: "Agent tools",
    description: "Give agentic applications access to a real browser.",
  },
};

const productGroupOrder: Array<Exclude<AudienceFilter, "all">> = [
  "people",
  "developers",
  "agents",
];

function ProductIcon({ kind }: { kind: ProductKind }) {
  const paths: Record<ProductKind, ReactNode> = {
    chrome: (
      <>
        <rect x="2.5" y="4" width="15" height="12" rx="2" />
        <path d="M2.5 7.5h15M5 5.8h.1M7 5.8h.1" />
      </>
    ),
    cli: (
      <>
        <path d="m4 6 4 4-4 4M10 14h6" />
        <rect x="2" y="3" width="16" height="14" rx="2" />
      </>
    ),
    cloud: (
      <>
        <path d="M6 15.5h9a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 5 8a4 4 0 0 0 1 7.5Z" />
        <path d="m8 12 2 2 3.5-4" />
      </>
    ),
    repair: (
      <>
        <path d="M4 5h7M4 10h5M4 15h7" />
        <path d="m12.5 11.5 1.5 1.5 3-3" />
      </>
    ),
    sdk: (
      <>
        <path d="m7 4-4 6 4 6M13 4l4 6-4 6M11 3 9 17" />
      </>
    ),
  };

  return (
    <span className="grid size-11 place-items-center rounded-lg border border-accent/25 bg-green-3/25 text-accent-bright">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      >
        {paths[kind]}
      </svg>
    </span>
  );
}

function ProductPreview({ item }: { item: ProductPath }) {
  return (
    <div className="relative min-h-[360px] w-full overflow-hidden border border-rule bg-surface/45 p-6 shadow-[10px_10px_0_rgba(42,255,97,0.04)] sm:p-8">
      <div className="mb-6 flex items-center justify-between border-b border-rule pb-4">
        <div className="flex items-center gap-3">
          <ProductIcon kind={item.kind} />
          <Text as="p" size="xs" className="text-ink">
            {item.product}
          </Text>
        </div>
        <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_rgba(42,255,97,0.7)]" />
      </div>

      {item.kind === "chrome" && (
        <div className="space-y-5">
          <div className="ml-8 rounded-xl rounded-tr-sm border border-accent/25 bg-green-3/20 p-4 text-sm leading-6 text-ink">
            Go to our vendors' websites, download every July invoice, and put
            them in one folder.
          </div>
          <div className="flex gap-3">
            <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-bg">
              L
            </span>
            <div className="flex-1">
              <p className="mb-3 text-sm text-ink">
                Working across 12 websites
              </p>
              <div className="h-1.5 overflow-hidden bg-rule">
                <div className="h-full w-4/5 bg-accent shadow-[0_0_12px_rgba(42,255,97,0.7)]" />
              </div>
              <p className="mt-3 font-mono text-xs text-accent-bright">
                9 invoices downloaded · 3 remaining
              </p>
            </div>
          </div>
        </div>
      )}

      {item.kind === "cli" && (
        <div className="font-mono text-sm leading-7">
          <p className="text-muted">$ libretto record invoice-download</p>
          <p className="mt-4 text-accent-bright">✓ Browser workflow captured</p>
          <p className="text-accent-bright">✓ Reliable selectors generated</p>
          <div className="mt-5 border-l-2 border-accent/50 bg-page/60 p-4 text-xs text-muted">
            <p>
              <span className="text-violet-300">export async function</span>{" "}
              downloadInvoices() &#123;
            </p>
            <p className="pl-4">await page.goto(vendorPortal);</p>
            <p className="pl-4">await downloadAllInvoices(page);</p>
            <p>&#125;</p>
          </div>
        </div>
      )}

      {item.kind === "cloud" && (
        <div>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="border border-rule bg-page/55 p-4">
              <p className="text-xs text-muted">Runs this month</p>
              <p className="mt-2 font-mono text-2xl text-ink">1,284</p>
            </div>
            <div className="border border-rule bg-page/55 p-4">
              <p className="text-xs text-muted">Success rate</p>
              <p className="mt-2 font-mono text-2xl text-accent-bright">
                99.2%
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-y-3 border-t border-rule pt-4 text-sm">
            <span className="text-ink">Daily invoice sync</span>
            <span className="text-accent-bright">Completed</span>
            <span className="text-ink">CRM enrichment</span>
            <span className="text-accent-bright">Running</span>
            <span className="text-ink">Weekly reporting</span>
            <span className="text-muted">Tomorrow</span>
          </div>
        </div>
      )}

      {item.kind === "repair" && (
        <div className="font-mono text-xs leading-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-ink">Fix checkout workflow</span>
            <span className="border border-accent/30 px-2 py-1 text-accent-bright">
              PR #184
            </span>
          </div>
          <div className="bg-page/65 p-4">
            <p className="text-red-300/80">
              - page.getByText(&quot;Place order&quot;)
            </p>
            <p className="text-accent-bright">
              + page.getByRole(&quot;button&quot;, &#123;
            </p>
            <p className="pl-5 text-accent-bright">
              name: &quot;Complete purchase&quot;
            </p>
            <p className="text-accent-bright">+ &#125;)</p>
          </div>
          <p className="mt-4 text-muted">
            ✓ Reproduced failure · ✓ Verified repair · ✓ Tests passed
          </p>
        </div>
      )}

      {item.kind === "sdk" && (
        <div className="flex flex-col items-center pt-3">
          <div className="border border-accent/35 bg-green-3/20 px-6 py-3 text-sm text-ink">
            Your agentic app
          </div>
          <div className="h-10 w-px bg-accent/50" />
          <div className="border border-rule bg-page/70 px-6 py-3 font-mono text-sm text-accent-bright">
            Browser Tools SDK
          </div>
          <div className="h-10 w-px bg-accent/50" />
          <div className="grid w-full grid-cols-3 gap-2 text-center font-mono text-xs text-muted">
            <span className="border border-rule p-3">Open</span>
            <span className="border border-rule p-3">Inspect</span>
            <span className="border border-rule p-3">Act</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductPaths() {
  const [copiedProduct, setCopiedProduct] = useState<string | null>(null);

  async function copyPrompt(item: ProductPath) {
    if (!item.prompt) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = item.prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedProduct(item.product);
    window.setTimeout(() => setCopiedProduct(null), 2200);
  }

  return (
    <section id="products" className="section-crt">
      {productGroupOrder.map((groupKey, groupIndex) => {
        const group = productGroups[groupKey];
        const groupProducts = products.filter(
          (item) => item.audienceFilter === groupKey,
        );

        return (
          <section
            key={groupKey}
            aria-labelledby={`product-group-${groupKey}`}
            className="border-t border-rule md:grid md:grid-cols-[150px_minmax(0,1fr)]"
          >
            <aside className="hidden border-r border-rule bg-green-3/[0.07] md:block">
              <div className="sticky top-20 px-5 py-9">
                <span className="mb-4 block size-2 bg-accent shadow-[0_0_10px_rgba(42,255,97,0.55)]" />
                <p className="mb-3 font-mono text-[10px] text-muted/55">
                  {String(groupIndex + 1).padStart(2, "0")}
                </p>
                <h2
                  id={`product-group-${groupKey}`}
                  className="mb-3 font-mono text-xs uppercase leading-5 tracking-[0.08em] text-accent-bright"
                >
                  {group.label}
                </h2>
                <p className="text-xs leading-5 text-muted">
                  {group.description}
                </p>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="border-b border-rule bg-green-3/[0.08] px-8 py-5 md:hidden">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-accent-bright">
                  {String(groupIndex + 1).padStart(2, "0")} · {group.label}
                </p>
                <p className="text-xs leading-5 text-muted">
                  {group.description}
                </p>
              </div>

              {groupProducts.map((item) => {
                const index = products.indexOf(item);
                return (
                  <article
                    key={item.product}
                    className={`border-b border-rule px-8 py-28 ${index % 2 === 1 ? "bg-green-3/[0.06]" : ""}`}
                  >
                    <div
                      className={`mx-auto flex max-w-[970px] flex-col items-center gap-14 lg:flex-row lg:gap-16 ${index % 2 === 1 ? "lg:flex-row-reverse" : ""}`}
                    >
                      <div className="w-full flex-1">
                        <div className="mb-6 flex items-center gap-4">
                          <span className="font-mono text-[11px] text-muted/50">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <Kicker className="text-sm text-accent">
                            // {item.product} --
                          </Kicker>
                        </div>
                        <Text
                          as="h3"
                          size="xl"
                          style="serif"
                          className="mb-6 font-[400] leading-[1.08] tracking-[-0.025em] text-ink"
                          htmlStyle={{ fontSize: "clamp(34px, 4vw, 54px)" }}
                        >
                          {item.title}
                        </Text>
                        <Text
                          as="p"
                          size="lg"
                          className="mb-9 max-w-[560px] leading-relaxed text-muted"
                        >
                          {item.description}
                        </Text>
                        {item.actionType === "copy" ? (
                          <div className="max-w-[560px] overflow-hidden border border-rule bg-page/65">
                            <div className="border-b border-rule px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                              Setup prompt
                            </div>
                            <p className="px-4 py-4 font-mono text-xs leading-5 text-muted">
                              {item.prompt}
                            </p>
                            <button
                              type="button"
                              onClick={() => void copyPrompt(item)}
                              className="flex w-full items-center justify-center border-t border-accent bg-accent px-6 py-3.5 text-sm font-medium text-bg shadow-[0_0_22px_rgba(42,255,97,0.24)] transition-colors hover:bg-accent-bright"
                              data-fathom-event={`Product path ${item.product} prompt copy`}
                            >
                              {copiedProduct === item.product
                                ? "Prompt copied ✓"
                                : `${item.action} →`}
                            </button>
                          </div>
                        ) : (
                          <a
                            href={item.href}
                            className="inline-flex items-center border border-accent bg-accent px-6 py-3.5 text-sm font-medium text-bg shadow-[0_0_22px_rgba(42,255,97,0.24)] transition-colors hover:bg-accent-bright"
                            data-fathom-event={`Product path ${item.product} click`}
                          >
                            {item.action} →
                          </a>
                        )}
                      </div>

                      <div className="w-full flex-1">
                        <ProductPreview item={item} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
