import { Text } from "./Text.js";
import { Kicker } from "./Kicker.js";
import { PRODUCTS } from "../products.js";
import { SectionDivider } from "./SectionDivider.js";

function ProductVisual({ index }: { index: number }) {
  if (index === 0) {
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

  if (index === 1) {
    return (
      <div className="overflow-hidden rounded-xl border border-rule bg-panel/60 p-5 shadow-lg shadow-black/25">
        <div className="mb-3 flex items-center gap-2">
          <span className="size-2 rounded-full bg-amber-bright" />
          <span className="font-mono text-xs text-muted">playwright · failed</span>
        </div>
        <div className="rounded-md border border-rule bg-bg/70 px-3 py-2 font-mono text-xs leading-5">
          <div className="text-red-300">TimeoutError: locator.fill</div>
          <div className="mt-2 text-accent-bright">+ opened PR #842</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-amber/50 bg-panel/40 p-5 shadow-lg shadow-black/25">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="-rotate-6 border-2 border-amber bg-bg/90 px-4 py-2 font-mono text-sm font-medium tracking-wide text-amber shadow-[4px_4px_0_color-mix(in_oklch,var(--color-amber)_35%,transparent)]">
          COMING SOON
        </div>
      </div>
      <div className="font-mono text-xs leading-6 text-muted/50">
        <div>createBrowserTools(page)</div>
        <div>tools.snapshot()</div>
        <div>tools.exec(...)</div>
      </div>
    </div>
  );
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
                  <ProductVisual index={index} />
                </div>
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
