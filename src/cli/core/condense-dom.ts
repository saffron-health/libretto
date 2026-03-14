/**
 * DOM condensation — reduces serialized HTML for LLM consumption.
 *
 * All rules run unconditionally (no tiers). The function operates on
 * already-serialized HTML strings (the output of `page.content()`),
 * not a browser-side DOM walk or parsed DOM tree.
 *
 * Rules applied in order:
 *   1.  Noscript blocks — remove entirely
 *   2.  HTML comments — remove entirely
 *   3.  Script contents — hollow out, keep tags + useful attributes
 *   4.  Style contents — hollow out, keep tags + useful attributes
 *   5.  Embedded binary data — replace base64 data URIs
 *   6.  Attribute allowlist — keep trusted attrs, special-case class/style/URLs
 *   7.  SVG elements — collapse to single tag, extract title/desc
 *   8.  Inline style properties — keep only layout-relevant props
 *   9.  Non-semantic class names — filter or delete class values
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

type ParsedAttribute = {
  name: string;
  rawToken: string;
  value: string | null;
};

const TEST_ATTRS = new Set(["data-testid", "data-test", "data-qa", "data-cy"]);
const TRUSTED_ATTRS = new Set([
  "id",
  "name",
  "for",
  "tabindex",
  "contenteditable",
  "role",
  "title",
  "alt",
  "type",
  "value",
  "placeholder",
  "autocomplete",
  "href",
  "action",
  "method",
  "src",
]);
const STATE_ATTRS = new Set([
  "disabled",
  "hidden",
  "inert",
  "readonly",
  "required",
  "checked",
  "selected",
  "open",
  "multiple",
]);
const BOOLEAN_ATTRS = new Set([
  ...STATE_ATTRS,
  "async",
  "defer",
  "nomodule",
]);
const EMPTY_VALUE_DROP_ATTRS = new Set([
  "alt",
  "autocomplete",
  "href",
  "action",
  "method",
  "name",
  "placeholder",
  "src",
  "tabindex",
  "title",
  "type",
]);
const URL_ATTRS = new Set(["href", "src", "action"]);
const SCRIPT_ATTRS = new Set([
  "src",
  "type",
  "id",
  "defer",
  "async",
  "crossorigin",
  "integrity",
  "nomodule",
  "referrerpolicy",
]);
const STYLE_TAG_ATTRS = new Set(["media", "type", "nonce", "title"]);
const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "details",
  "dialog",
  "label",
]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "combobox",
]);
const OPEN_TAG_PATTERN =
  /<([a-zA-Z][\w:-]*)(\s(?:[^"'<>/]|"[^"]*"|'[^']*')*)?\s*(\/?)>/g;

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
  result = track(
    "comments",
    result,
    result.replace(/<!--[\s\S]*?(?:-->|$)/g, ""),
  );

  // ── Rule 3: Script contents ──────────────────────────────────────────
  result = track(
    "scripts",
    result,
    result.replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script(?:\s[^>]*)?>)/gi,
      (_match, open: string, content: string, close: string) => {
        if (!content.trim()) return `${open}${close}`;
        const isDataScript =
          /type\s*=\s*["']application\/(json|ld\+json)["']/i.test(open);
        if (isDataScript) {
          return `${open}[JSON data, ${content.length} chars]${close}`;
        }
        return `${open}[script, ${content.length} chars]${close}`;
      },
    ),
  );

  // ── Rule 4: Style contents ───────────────────────────────────────────
  result = track(
    "styles",
    result,
    result.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style(?:\s[^>]*)?>)/gi,
      (_match, open: string, content: string, close: string) => {
        if (!content.trim()) return `${open}${close}`;
        return `${open}[CSS, ${content.length} chars]${close}`;
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

  // ── Rule 6: Attribute allowlist ──────────────────────────────────────
  result = track("attribute-allowlist", result, rewriteTagAttributes(result));

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
        const filtered = filterSemanticClasses(value);
        if (!filtered) return "";
        return ` class="${filtered}"`;
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
    const placeholder = `__PRE_PLACEHOLDER_${i}__`;
    const preBlock = preBlocks[i]!;
    result = result.replace(placeholder, () => preBlock);
  }

  return {
    html: result,
    originalLength,
    condensedLength: result.length,
    reductions,
  };
}

function rewriteTagAttributes(html: string): string {
  return html.replace(
    OPEN_TAG_PATTERN,
    (match, rawTagName: string, rawAttrs: string | undefined, selfClosing: string) => {
      const tagName = rawTagName.toLowerCase();
      if (!rawAttrs?.trim()) return match;

      const attrs = parseAttributes(rawAttrs);
      if (attrs.length === 0) return match;

      const interactive = isInteractiveElement(tagName, attrs);
      const kept = attrs
        .map((attr) => keepAttribute(tagName, attr, interactive))
        .filter((value): value is string => value !== null);

      const attrStr = kept.length > 0 ? ` ${kept.join(" ")}` : "";
      const closing = selfClosing ? " /" : "";
      return `<${rawTagName}${attrStr}${closing}>`;
    },
  );
}

function keepAttribute(
  tagName: string,
  attr: ParsedAttribute,
  interactive: boolean,
): string | null {
  const name = attr.name.toLowerCase();
  const value = attr.value;

  if (name === "class") {
    if (!value?.trim()) return null;
    const filtered = filterSemanticClasses(value);
    if (!filtered) return null;
    return serializeAttribute(attr.name, filtered);
  }

  if (name === "style") {
    if (!value?.trim()) return null;
    return serializeAttribute(attr.name, value);
  }

  if (name.startsWith("aria-")) {
    if (!value?.trim()) return null;
    return attr.rawToken;
  }

  if (TEST_ATTRS.has(name)) {
    if (!value?.trim()) return null;
    return attr.rawToken;
  }

  if (tagName === "script" && SCRIPT_ATTRS.has(name)) {
    return serializePreservedAttribute(attr);
  }

  if (tagName === "style" && STYLE_TAG_ATTRS.has(name)) {
    if (!value?.trim()) return null;
    return attr.rawToken;
  }

  if (STATE_ATTRS.has(name)) {
    return serializePreservedAttribute(attr);
  }

  if (URL_ATTRS.has(name)) {
    if (!value?.trim()) return null;
    const normalized = normalizeUrlValue(value);
    if (normalized === value) return attr.rawToken;
    return serializeAttribute(attr.name, normalized);
  }

  if (TRUSTED_ATTRS.has(name)) {
    if (shouldDropEmptyValue(name, value)) return null;
    return serializePreservedAttribute(attr);
  }

  if (shouldKeepCustomDataAttribute(tagName, name, value, interactive)) {
    return attr.rawToken;
  }

  return null;
}

function serializePreservedAttribute(attr: ParsedAttribute): string | null {
  if (BOOLEAN_ATTRS.has(attr.name.toLowerCase())) {
    return attr.rawToken;
  }
  if (attr.value === null) return attr.rawToken;
  return attr.rawToken;
}

function shouldDropEmptyValue(
  name: string,
  value: string | null,
): boolean {
  if (value === null) return false;
  if (value.trim()) return false;
  if (name.startsWith("aria-")) return true;
  return EMPTY_VALUE_DROP_ATTRS.has(name);
}

function normalizeUrlValue(value: string): string {
  const loweredValue = value.trim().toLowerCase();
  if (loweredValue.startsWith("blob:")) return "blob:[omitted]";
  if (loweredValue.startsWith("javascript:")) return "javascript:[omitted]";
  if (loweredValue.startsWith("vbscript:")) return "vbscript:[omitted]";
  if (loweredValue.startsWith("data:")) return "data:[omitted]";
  if (value.length <= 160) return value;

  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const parsed = isAbsolute
      ? new URL(value)
      : new URL(value, "https://condensed.local");

    const prefix = isAbsolute
      ? `${parsed.protocol}//${parsed.host}${parsed.pathname}`
      : `${parsed.pathname}${parsed.hash}`;
    const query = parsed.search ? "?[query omitted]" : "";
    return `${prefix}${query}`;
  } catch {
    return `${value.slice(0, 96)}[omitted]`;
  }
}

function filterSemanticClasses(value: string): string {
  const classes = value.split(/\s+/).filter(Boolean);
  const kept = classes.filter((cls) => !isObfuscatedClass(cls));
  return kept.join(" ");
}

/**
 * Heuristic: a class name is "obfuscated" if it looks like a hash or random ID
 * rather than a human-readable semantic name.
 */
function isObfuscatedClass(cls: string): boolean {
  if (cls.length > 80) return true;
  if (/^_?[0-9a-f]{6,}$/i.test(cls)) return true;
  if (/^[a-z]+_[0-9a-f]{4,}$/i.test(cls)) return true;
  if (/^[a-z]{1,2}[0-9]{2,}$/i.test(cls)) return true;

  const digits = (cls.match(/[0-9]/g) || []).length;
  const letters = (cls.match(/[a-zA-Z]/g) || []).length;
  if (cls.length >= 6 && digits >= letters * 0.5 && digits >= 2) return true;

  return false;
}

function parseAttributes(rawAttrs: string): ParsedAttribute[] {
  const attrs: ParsedAttribute[] = [];
  const attrPattern =
    /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const name = match[1];
    if (!name) continue;
    attrs.push({
      name,
      rawToken: match[0]!.trim(),
      value: match[2] ?? match[3] ?? match[4] ?? null,
    });
  }

  return attrs;
}

function isInteractiveElement(
  tagName: string,
  attrs: ParsedAttribute[],
): boolean {
  if (INTERACTIVE_TAGS.has(tagName)) return true;

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (name === "tabindex" || name === "contenteditable") return true;
    if (name !== "role") continue;

    const role = attr.value?.trim().toLowerCase();
    if (role && INTERACTIVE_ROLES.has(role)) {
      return true;
    }
  }

  return false;
}

function shouldKeepCustomDataAttribute(
  tagName: string,
  attrName: string,
  value: string | null,
  interactive: boolean,
): boolean {
  if (!interactive) return false;
  if (!attrName.startsWith("data-")) return false;
  if (TEST_ATTRS.has(attrName)) return false;
  if (!value?.trim()) return false;
  if (value.length > 80) return false;
  if (tagName === "script" || tagName === "style") return false;

  const key = attrName.slice("data-".length);
  if (!looksMeaningfulToken(key)) return false;
  if (!looksMeaningfulDataValue(value)) return false;

  return true;
}

function looksMeaningfulToken(value: string): boolean {
  if (!/^[a-z][a-z0-9-]{1,40}$/i.test(value)) return false;
  if (!/[a-z]{3}/i.test(value)) return false;
  if (/(track|metric|telemetry|analytics|component|display|loaded|token|dps|color|screen|strict|rehydr|fetch)/i.test(value)) {
    return false;
  }
  return true;
}

function looksMeaningfulDataValue(value: string): boolean {
  if (value.length > 80) return false;
  if (/[<>]/.test(value)) return false;
  if (/https?:\/\//i.test(value)) return false;
  return /^[a-z0-9:_./ -]+$/i.test(value);
}

function findAttributeToken(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(
      `(?:^|\\s)(${escapeRegExp(name)}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\\x60]+))?)`,
      "i",
    ),
  );
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeAttribute(name: string, value: string): string {
  return `${name}="${escapeHtmlAttribute(value)}"`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
