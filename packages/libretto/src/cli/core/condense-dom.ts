/**
 * DOM condensation — reduces serialized HTML for LLM consumption.
 *
 * All rules run unconditionally (no tiers). The function operates on
 * already-serialized HTML strings (the output of `page.content()`),
 * not a browser-side DOM walk or parsed DOM tree.
 *
 * Rules applied in order:
 *   1.  Noscript blocks — remove entirely
 *   2.  HTML comments — remove (except IE conditionals)
 *   3.  Script contents — hollow out, keep tags + attributes
 *   4.  Style contents — hollow out, keep tags + attributes
 *   5.  Embedded binary data — replace base64 data URIs
 *   6.  Large opaque attribute values — truncate non-preserved attrs > 200 chars
 *   7.  SVG elements — collapse to single tag, extract title/desc
 *   8.  Inline style properties — keep only layout-relevant props
 *   9.  Non-semantic class names — strip obfuscated/hash-like classes
 *  10.  (Cross-reference IDs — preserved, no action needed)
 *  11.  Framework-internal and SVG visual attributes — remove
 *  12.  Whitespace — collapse (preserve <pre> content)
 */

export type CondenseDomResult = {
  /** The condensed HTML string. Valid, parseable HTML. */
  html: string;
  /** Character count of the input. */
  originalLength: number;
  /** Character count of the output. */
  condensedLength: number;
  /** Characters removed, keyed by rule name. */
  reductions: Record<string, number>;
};

/** Attributes exempt from Rule 6 truncation (the full selector-relevant preserve list). */
const PRESERVED_ATTRS = new Set([
  "id",
  "name",
  "for",
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "aria-hidden",
  "aria-haspopup",
  "aria-controls",
  "aria-owns",
  "aria-live",
  "role",
  "title",
  "alt",
  "type",
  "value",
  "placeholder",
  "href",
  "action",
  "method",
  "src",
]);

export function condenseDom(html: string): CondenseDomResult {
  const originalLength = html.length;
  const reductions: Record<string, number> = {};

  function track(label: string, before: string, after: string): string {
    const diff = before.length - after.length;
    if (diff > 0) {
      reductions[label] = (reductions[label] ?? 0) + diff;
    }
    return after;
  }

  let result = html;

  // ── Rule 1: Noscript blocks ──────────────────────────────────────────
  result = track(
    "noscript",
    result,
    result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ""),
  );

  // ── Rule 2: HTML comments ────────────────────────────────────────────
  // Keep IE conditional comments (<!--[if ...)
  result = track(
    "comments",
    result,
    result.replace(/<!--(?!\[if\s)[\s\S]*?-->/g, ""),
  );

  // ── Rule 3: Script contents ──────────────────────────────────────────
  result = track(
    "scripts",
    result,
    result.replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_match, open: string, content: string, close: string) => {
        if (!content.trim()) return `${open}${close}`;
        const isDataScript =
          /type\s*=\s*["']application\/(json|ld\+json)["']/i.test(open);
        if (isDataScript) {
          return `${open}<!-- [JSON data, ${content.length} chars] -->${close}`;
        }
        return `${open}<!-- [script, ${content.length} chars] -->${close}`;
      },
    ),
  );

  // ── Rule 4: Style contents ───────────────────────────────────────────
  result = track(
    "styles",
    result,
    result.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_match, open: string, content: string, close: string) => {
        if (!content.trim()) return `${open}${close}`;
        return `${open}<!-- [CSS, ${content.length} chars] -->${close}`;
      },
    ),
  );

  // ── Rule 5: Embedded binary data ─────────────────────────────────────
  result = track(
    "base64",
    result,
    result.replace(
      /(src|href)\s*=\s*["'](data:[^;]+;base64,)[A-Za-z0-9+/=]{100,}["']/gi,
      (_match, attr: string, prefix: string) => {
        const mime = prefix.replace("data:", "").replace(";base64,", "");
        return `${attr}="[base64 ${mime}]"`;
      },
    ),
  );

  // ── Rule 6: Large opaque attribute values ────────────────────────────
  // Truncate any attribute value > 200 chars that isn't on the preserve list.
  result = track(
    "large-attrs",
    result,
    result.replace(
      /\s([\w-]+)\s*=\s*["']([^"']{200,})["']/gi,
      (match, attr: string, value: string) => {
        if (PRESERVED_ATTRS.has(attr.toLowerCase())) return match;
        return ` ${attr}="[${value.length} chars]"`;
      },
    ),
  );

  // ── Rule 7: SVG elements ─────────────────────────────────────────────
  // Collapse each <svg> to a single tag, preserving key attributes.
  // Extract <title>/<desc> text as aria-label if none exists.
  // Iterate from innermost to outermost to handle nested SVGs correctly.
  const svgPattern = /<svg\b([^>]*)>((?:(?!<svg\b)[\s\S])*?)<\/svg>/gi;
  result = track(
    "svg-collapse",
    result,
    (() => {
      let prev: string;
      let current = result;
      do {
        prev = current;
        current = current.replace(
          svgPattern,
          (_match, attrs: string, inner: string) => {
            // Extract attributes we want to keep
            const keepAttrs: string[] = [];
            const attrPatterns = [
              "id",
              "class",
              "role",
              "aria-label",
              "aria-hidden",
              "title",
              "data-testid",
            ];
            for (const name of attrPatterns) {
              const attrToken = findAttributeToken(attrs, name);
              if (attrToken) keepAttrs.push(attrToken);
            }

            // Extract <title> or <desc> text for aria-label if not already present
            const hasAriaLabel = /aria-label\s*=/i.test(attrs);
            if (!hasAriaLabel) {
              const titleMatch = inner.match(
                /<title[^>]*>([^<]+)<\/title>/i,
              );
              const descMatch = inner.match(
                /<desc[^>]*>([^<]+)<\/desc>/i,
              );
              const labelText =
                titleMatch?.[1]?.trim() || descMatch?.[1]?.trim();
              if (labelText) {
                keepAttrs.push(
                  `aria-label="${escapeHtmlAttribute(labelText)}"`,
                );
              }
            }

            const attrStr =
              keepAttrs.length > 0 ? ` ${keepAttrs.join(" ")}` : "";
            return `<svg${attrStr}><!-- [icon] --></svg>`;
          },
        );
        svgPattern.lastIndex = 0;
      } while (current !== prev);
      return current;
    })(),
  );

  // ── Rule 8: Inline style properties ──────────────────────────────────
  // Keep only layout-relevant properties.
  const layoutProps =
    /(?:^|;)\s*(?:display|visibility|opacity|pointer-events|position|z-index|overflow)(?:-[a-z]+)?\s*:[^;"]*/gi;

  result = track(
    "inline-styles",
    result,
    result.replace(
      /\sstyle\s*=\s*["']([^"']*)["']/gi,
      (_match, value: string) => {
        const kept: string[] = [];
        let propMatch: RegExpExecArray | null;
        layoutProps.lastIndex = 0;
        while ((propMatch = layoutProps.exec(value)) !== null) {
          kept.push(propMatch[0].replace(/^[;\s]+/, "").trim());
        }
        if (kept.length === 0) return "";
        return ` style="${kept.join("; ")}"`;
      },
    ),
  );

  // ── Rule 9: Non-semantic class names ─────────────────────────────────
  result = track(
    "obfuscated-classes",
    result,
    result.replace(
      /\sclass\s*=\s*["']([^"']*)["']/gi,
      (_match, value: string) => {
        const classes = value.split(/\s+/).filter(Boolean);
        const kept = classes.filter((cls) => !isObfuscatedClass(cls));
        if (kept.length === 0) return "";
        return ` class="${kept.join(" ")}"`;
      },
    ),
  );

  // ── Rule 10: Cross-reference IDs — no action, preserved by default ──

  // ── Rule 11: Framework-internal and SVG visual attributes ────────────
  const removableAttrs =
    /\s(?:xmlns(?::[a-z]+)?|xml:space|xml:lang|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-dasharray|stroke-dashoffset|stroke-opacity|fill-opacity|clip-rule|fill-rule|focusable)\s*=\s*["'][^"']*["']/gi;
  result = track(
    "framework-svg-attrs",
    result,
    result.replace(removableAttrs, ""),
  );

  // ── Rule 12: Whitespace ──────────────────────────────────────────────
  // Collapse runs of spaces/tabs to a single space, multiple blank lines
  // to a single newline. Preserve <pre> content.
  const preBlocks: string[] = [];
  result = result.replace(
    /(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi,
    (_match, open: string, content: string, close: string) => {
      const idx = preBlocks.length;
      preBlocks.push(`${open}${content}${close}`);
      return `__PRE_PLACEHOLDER_${idx}__`;
    },
  );

  result = track(
    "whitespace",
    result,
    result.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n"),
  );

  for (let i = 0; i < preBlocks.length; i++) {
    result = result.replace(`__PRE_PLACEHOLDER_${i}__`, preBlocks[i]!);
  }

  return {
    html: result,
    originalLength,
    condensedLength: result.length,
    reductions,
  };
}

/**
 * Heuristic: a class name is "obfuscated" if it looks like a hash or random ID
 * rather than a human-readable semantic name.
 */
function isObfuscatedClass(cls: string): boolean {
  // Pure hex-like: _2fde8c88, bf2ad191, a1b2c3d4
  if (/^_?[0-9a-f]{6,}$/i.test(cls)) return true;

  // CSS module pattern: component_hash (single underscore + hash suffix)
  if (/^[a-z]+_[0-9a-f]{4,}$/i.test(cls)) return true;

  // Very short random-looking (2-3 chars + 2+ digits, avoids h1/p2/m3 utility classes)
  if (/^[a-z]{1,2}[0-9]{2,}$/i.test(cls)) return true;

  // High ratio of digits to letters (hashes tend to mix digits in)
  const digits = (cls.match(/[0-9]/g) || []).length;
  const letters = (cls.match(/[a-zA-Z]/g) || []).length;
  if (cls.length >= 6 && digits >= letters * 0.5 && digits >= 2) return true;

  return false;
}

function findAttributeToken(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(
      `(?:^|\\s)(${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'))`,
      "i",
    ),
  );
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
