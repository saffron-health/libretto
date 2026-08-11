import { Text } from "./Text.js";
import { Kicker } from "./Kicker.js";
import { PRODUCTS } from "../products.js";
import { SectionDivider } from "./SectionDivider.js";

function ProductVisual({ href }: { href: string }) {
  if (href === "/chrome-extension") {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-panel/60 shadow-lg shadow-black/25">
        <div className="flex items-center gap-2 border-b border-rule px-5 py-3.5">
          <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_rgba(42,255,97,0.55)]" />
          <span className="font-mono text-xs text-ink/70">
            Libretto for Chrome
          </span>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-accent/20 bg-green-9/10 px-4 py-3 text-sm leading-6 text-ink">
            Download this month&apos;s invoices from every vendor portal.
          </div>
          <div>
            <div className="mb-2 flex justify-between font-mono text-[11px] text-muted">
              <span>Working across 12 websites</span>
              <span className="text-accent-bright">9 complete</span>
            </div>
            <div className="h-1 overflow-hidden bg-rule">
              <div className="h-full w-3/4 bg-accent" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (href === "/cli") {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-panel/60 p-5 font-mono text-xs leading-6 text-muted shadow-lg shadow-black/25">
        <div className="mb-3 text-amber">$ npx libretto open</div>
        <div>
          <span className="text-accent-bright">→</span> session{" "}
          <span className="text-ink">ses-4f2a</span>
        </div>
        <div>
          <span className="text-accent-bright">→</span> record actions, capture
          network, write scripts
        </div>
        <div className="mt-4 text-ink">
          await page.getByRole(&quot;button&quot;, {"{"} name: &quot;Book&quot; {"}"}).click()
        </div>
      </div>
    );
  }

  if (href === "/debug-agents") {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-panel/60 shadow-lg shadow-black/25">
        <div className="flex items-center gap-2 border-b border-rule px-5 py-3.5">
          <span className="size-2 rounded-full bg-red-300" />
          <span className="font-mono text-xs text-ink/70">
            playwright run · failed
          </span>
        </div>
        <div className="p-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            Fix proposed
          </div>
          <div className="mb-3 text-sm text-ink">
            Updated the renamed username field selector
          </div>
          <div className="overflow-hidden rounded-md border border-rule font-mono text-[11px] leading-5">
            <div className="bg-red-500/10 px-3 py-1 text-red-300">
              - input[name=&quot;username&quot;]
            </div>
            <div className="bg-green-9/15 px-3 py-1 text-accent-bright">
              + input[name=&quot;login&quot;]
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3 font-mono text-xs text-accent-bright">
            <span aria-hidden="true">✓</span>
            <span>Pull request #842 opened</span>
          </div>
        </div>
      </div>
    );
  }

  if (href === "/browser-tools") {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-panel/60 p-5 font-mono text-xs leading-6 text-muted shadow-lg shadow-black/25">
        <div className="mb-3 text-[10px] uppercase tracking-[0.12em] text-faint">
          AGENT.TS
        </div>
        <div>
          <span className="text-faint">const</span>
          <span className="text-ink"> {"{ tools }"} = </span>
          <span className="text-accent-bright">createAiSdkBrowserTools</span>
          <span className="text-ink">(provider);</span>
        </div>
        <div className="mt-3">
          <span className="text-faint">await</span>
          <span className="text-accent-bright"> generateText</span>
          <span className="text-ink">({"{"}</span>
        </div>
        <div className="pl-3 text-ink">tools,</div>
        <div className="pl-3">
          <span className="text-ink">prompt: </span>
          <span className="text-amber">&quot;Find the top story&quot;</span>
          <span className="text-ink">,</span>
        </div>
        <div className="text-ink">{"})"};</div>
      </div>
    );
  }

  return null;
}

export function ProductListing() {
  return (
    <section className="section-crt px-8 py-8 md:py-12">
      <div className="mx-auto max-w-[1000px]">
        {PRODUCTS.map((product, index) => {
          const visualLeft = index % 2 === 1;
          return (
            <div key={product.href}>
              {index > 0 ? <SectionDivider /> : null}
              <a
                href={product.href}
                data-fathom-event={product.fathomEvent}
                className="group grid items-center gap-10 py-16 no-underline md:grid-cols-2 md:gap-16 md:py-20"
              >
                <div className={visualLeft ? "md:order-2" : undefined}>
                  <Kicker className="mb-3">{product.kicker}</Kicker>
                  <Text
                    as="h2"
                    size="3xl"
                    style="serif"
                    className="crt-glow mb-4 tracking-[-0.02em] text-ink [text-wrap:pretty] transition-colors group-hover:text-accent-bright"
                    htmlStyle={{
                      fontWeight: 300,
                      fontSize: "clamp(32px, 4vw, 48px)",
                      lineHeight: 1.15,
                    }}
                  >
                    {product.name}
                  </Text>
                  <Text
                    as="p"
                    size="md"
                    className="max-w-[420px] leading-relaxed text-muted [text-wrap:pretty]"
                  >
                    {product.tagline}
                  </Text>
                  <div className="mt-6 inline-flex items-center gap-2 text-sm text-accent-bright">
                    {product.status === "soon" ? "Coming soon" : "Explore"}
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </div>
                </div>
                <div className={visualLeft ? "md:order-1" : undefined}>
                  <ProductVisual href={product.href} />
                </div>
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
