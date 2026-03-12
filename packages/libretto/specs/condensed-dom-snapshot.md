# Condensed DOM Snapshot

## Problem overview

The snapshot analyzer currently captures full `page.content()` HTML and also writes an abbreviated/trimmed HTML artifact for the snapshot run. On complex pages (LinkedIn, EMR portals), the full HTML is 500K–1MB — far exceeding useful context window budgets. The condensed HTML logic needs to be updated so the abbreviated artifact follows the rules in this spec rather than the older tiered trimming behavior.

Other DOM consumers (`extract.ts`, `errors.ts`) have the same problem at smaller scale: they truncate at 30K–50K with a simple slice, losing everything after the cut.

A principled HTML reduction pass that strips high-volume, low-value content before the LLM sees it would let more of the structurally important DOM fit within context limits.

## Solution overview

Add a `condenseDom()` function that transforms serialized HTML strings (the output of `page.content()`) into a reduced form. It operates as a **string transform on already-serialized HTML** — not a browser-side DOM walk, not a parsed DOM tree. This keeps it usable by all three current DOM consumers without changing their capture paths.

For the snapshot CLI specifically, keep the existing artifact pattern: write the full HTML snapshot and the condensed HTML snapshot into the same snapshot run directory as the PNG (for example `page.png`, `page.html`, `page.condensed.html`). The analyzer should be pointed at both files by path so it can start from the condensed DOM and fall back to the full DOM if needed. For `extract.ts` and `errors.ts`, condensation can happen in memory before any length-based truncation; those flows do not need to persist a second HTML artifact.

The function applies a fixed set of reduction rules in order. Each rule targets a category of content that is either redundant with the screenshot, structurally meaningless to a page consumer, or too large relative to its informational value.

The output is **valid HTML** (parseable, with correct nesting preserved). Removed content is either deleted entirely or replaced with an HTML comment placeholder (`<!-- [N chars removed: description] -->`), never with ad-hoc syntax that would break HTML parsing. This matters because the analyzer prompt tells the model to return selectors that exist in the HTML snapshot.

## Goals

- Reduce LinkedIn-class pages from ~950K to under 250K characters while preserving all information needed for selector generation and page-state analysis.
- Provide a single function usable by `snapshot-analyzer.ts`, `extract.ts`, and `errors.ts` without changing their capture mechanism (`page.content()`).
- All reduction rules are general (based on observable properties of the HTML), not site-specific.
- Output remains valid, parseable HTML.

## Non-goals

- No browser-side DOM manipulation or `page.evaluate()` capture paths. The function operates on the serialized HTML string that `page.content()` already returns.
- No parsed DOM tree walking (e.g., jsdom, cheerio). Rules operate via regex/string transforms on serialized HTML. Rule 10 (empty elements) is deferred to a future phase because it requires tree awareness.
- No objective-aware trimming. The same rules apply regardless of what the user is asking about.
- No changes to the LLM prompt or the `InterpretResult` schema.
- No structural deduplication of repeated siblings (future work).

## Important files

- `packages/libretto/src/cli/core/dom-trimmer.ts` — current implementation (to be renamed/refactored to `condenseDom()`).
- `packages/libretto/src/cli/core/snapshot-analyzer.ts` — primary consumer. Reads snapshot artifacts by path, tells the analyzer to start from the condensed DOM and fall back to the full DOM.
- `packages/libretto/src/runtime/extract/extract.ts` — extraction consumer. Captures `page.content()` and truncates at 50K. Lines 54–58.
- `packages/libretto/src/runtime/recovery/errors.ts` — error detection consumer. Captures `page.content()` and truncates at 50K. Lines 72–77. Explicitly checks DOM for error messages that may not be visible in the screenshot (line 102).
- `packages/libretto/src/cli/commands/snapshot.ts` — CLI entry point that captures HTML and calls `runInterpret()`.

## Preserve list

The condensed output must retain all of the following, regardless of which rules are applied:

### Interactive elements
All elements that can receive user interaction: `<a>`, `<button>`, `<input>`, `<select>`, `<textarea>`, `<form>`, `<details>`, `<dialog>`, `<label>`, and any element with `tabindex`, `contenteditable`, `role="button"`, `role="link"`, `role="tab"`, `role="menuitem"`, `role="checkbox"`, `role="radio"`, `role="switch"`, `role="slider"`, or `role="combobox"`.

### Selector-relevant attributes
- Identity: `id`, `name`, `for`.
- Testing: `data-testid`, `data-test`, `data-qa`, `data-cy`.
- Accessibility: `aria-label`, `aria-labelledby`, `aria-expanded`, `aria-selected`, `aria-checked`, `aria-disabled`, `aria-hidden`, `aria-haspopup`, `aria-controls`, `aria-owns`, `aria-live`, `aria-describedby`.
- Semantic: `role`, `title`, `alt`, `type`, `value`, `placeholder`, `href`, `action`, `method`, `src` (on `<img>`, `<iframe>`, `<video>`, `<audio>`, `<source>`).

### State and visibility signals
- `disabled`, `hidden`, `inert`, `readonly`, `required`.
- Inline style properties that affect interactability: `display`, `visibility`, `opacity`, `pointer-events`, `position`, `z-index`, `overflow` (and sub-properties like `overflow-x`).

### All text content
All text nodes, including text inside `aria-hidden="true"` elements, screen-reader-only spans, hidden validation messages, and live regions. The `errors.ts` consumer explicitly needs DOM text that is not visible in the screenshot (line 102), and `aria-label` values on other elements often reference this hidden text. "All text nodes" means: if a text node exists in the serialized HTML, it survives condensing.

### Structural nesting
The ancestor chain of every preserved element remains intact. No rule may delete a container element that has preserved descendants. Rules may strip _attributes_ from container elements but never remove the element itself if doing so would change the nesting context of a preserved descendant.

## Reduction rules

Rules are applied in the order listed below, always. There is no conditional "apply if over target size" logic — all rules run unconditionally, because they target content that is low-value regardless of page size. The `truncateText()` head/tail fallback remains as a final safety net after all rules have been applied.

### Rule 1: Noscript blocks
**Remove** `<noscript>` elements and their contents entirely. The page runs in a browser with JavaScript enabled; noscript content is never rendered or interactive.

### Rule 2: HTML comments
**Remove** all HTML comments (`<!-- ... -->`), except IE conditional comments (`<!--[if ...`). Build artifacts and framework markers.

### Rule 3: Script contents
**Hollow out** `<script>` tags: keep the opening and closing tags with all attributes (`src`, `type`, `id`, `defer`, `async`), replace the inline content with `<!-- [script, N chars] -->`. For `<script type="application/json">` or `application/ld+json`, use `<!-- [JSON data, N chars] -->`.

**Why keep the tag:** The `src` attribute tells the model what scripts are loaded. The placeholder tells the model a script existed and how large it was.

### Rule 4: Style contents
**Hollow out** `<style>` tags: keep the tag with attributes, replace content with `<!-- [CSS, N chars] -->`.

### Rule 5: Embedded binary data
**Replace** base64 data URIs in `src` and `href` attributes with `[base64 <mime-type>]`. The model cannot decode base64; the screenshot shows the image.

### Rule 6: Large opaque attribute values
**Truncate** any attribute value longer than 200 characters that is not on the preserve list. The preserve list for this rule is the full selector-relevant attribute set from above: `id`, `name`, `for`, `data-testid`, `data-test`, `data-qa`, `data-cy`, `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-expanded`, `aria-selected`, `aria-checked`, `aria-disabled`, `aria-hidden`, `aria-haspopup`, `aria-controls`, `aria-owns`, `aria-live`, `role`, `title`, `alt`, `type`, `value`, `placeholder`, `href`, `action`, `method`, and the allowed `src` attributes. Replace all other long values with `[N chars]`.

This is general — it catches `data-*` tracking blobs, serialized state, encoded configs, and any other long machine-readable values, without needing to enumerate specific attribute names.

### Rule 7: SVG elements
**Collapse** each `<svg>` element into a single tag, preserving its `id`, `class`, `role`, `aria-label`, `aria-hidden`, `title`, and `data-testid` attributes. Replace all children with a single `<!-- [icon] -->` comment — except: if the SVG contains a `<title>` or `<desc>` child, extract that text and include it as `aria-label` on the collapsed `<svg>` (if no `aria-label` already exists). This ensures icon-only buttons whose label comes from an SVG `<title>` don't lose their only textual identifier.

**Rationale:** On normal websites, SVG contents are overwhelmingly geometry (`<path>`, `<circle>`, `<rect>`, `<polygon>`, `<g>`, etc.), not rich HTML content. The bulky part is usually path data and other vector internals, which do not help with selector generation. The only SVG content we care about preserving is labeling and selector-relevant outer attributes.

**Output example:**
```html
<svg role="img" aria-label="Like"><!-- [icon] --></svg>
```

### Rule 8: Inline style properties
**Strip** visual-only CSS properties from `style=""` attributes. Keep only: `display`, `visibility`, `opacity`, `pointer-events`, `position`, `z-index`, `overflow`, `overflow-x`, `overflow-y`. Remove the entire `style` attribute if no properties survive.

### Rule 9: Non-semantic class names
**Strip** individual class names from `class=""` attributes that are obfuscated or hash-like. Keep class names that appear semantically meaningful.

Detection heuristic (classify as **obfuscated** if any match):
- Matches `_?[0-9a-f]{6,}` (hex hash, possibly underscore-prefixed).
- Matches `[a-z]+_[0-9a-f]{4,}` (CSS module pattern: word + hash suffix).
- Matches `[a-z]{1,2}[0-9]+` (short random: `a1`, `b42`).
- Has 6+ characters and digit-to-letter ratio ≥ 0.5 with at least 2 digits.

If all classes on an element are stripped, remove the entire `class` attribute. If some remain, keep only the surviving ones.

**Cost of false positives:** On pages that expose _only_ hash-like classes (no `id`, `data-testid`, `aria-label`, or `role`), stripping classes can make selector generation harder. This is an accepted tradeoff — such pages already have poor selector surface, and the model can fall back to structural/positional selectors or text-based matching. The class names change between builds anyway, so selectors based on them would be fragile.

### Rule 10: Cross-reference ID attributes
**Keep** `aria-labelledby`, `aria-describedby`, `aria-controls`, and `aria-owns`.

`aria-labelledby` is usually short and low-cost, and it preserves the explicit relationship between a control and the element that provides its accessible name. That relationship is useful for icon-only buttons, custom controls, and controls named by off-element or hidden text. The token savings from removing it are too small to justify the loss of information.

`aria-describedby`, `aria-controls`, and `aria-owns` also convey structural relationships (which panel does this tab control? what element describes this input's validation error?) that are not always obvious from DOM nesting. `aria-describedby` in particular is used by the error detection flow to link controls to their validation messages.

### Rule 11: Framework-internal and SVG visual attributes
**Remove** attributes that match these categories:

- **XML namespace declarations:** `xmlns`, `xmlns:*`, `xml:space`, `xml:lang`.
- **SVG visual attributes** (only meaningful after Rule 7 if SVGs survived): `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-opacity`, `fill-opacity`, `clip-rule`, `fill-rule`, `focusable` (on SVGs).

Framework-internal attributes (like LinkedIn's `componentkey`) are handled by Rule 6 if their values are long, or by being non-semantic single-word non-standard attributes. Rather than maintaining a blocklist, we accept that short framework attributes (a few chars each) are low-cost to leave in. The 200-char threshold in Rule 6 catches the expensive ones.

### Rule 12: Whitespace
**Collapse** runs of spaces/tabs to a single space. Collapse multiple blank lines to a single newline. **Preserve** whitespace inside `<pre>` elements.

This rule preserves text content semantically, not byte-for-byte. Text nodes survive, but non-meaningful whitespace is normalized outside `<pre>`.

## Output contract

```typescript
type CondenseDomResult = {
  /** The condensed HTML string. Valid, parseable HTML. */
  html: string;
  /** Character count of the input. */
  originalLength: number;
  /** Character count of the output. */
  condensedLength: number;
  /** Characters removed, keyed by rule name. */
  reductions: Record<string, number>;
};

function condenseDom(html: string): CondenseDomResult;
```

The function takes a serialized HTML string (as returned by `page.content()`) and returns a condensed HTML string. There are no tiers, no configuration, no target size parameter. All rules always run. The existing `truncateText()` in `snapshot-analyzer.ts` remains as a separate downstream safety net.

## Implementation

### Phase 1: Rename and consolidate

Rename `dom-trimmer.ts` to `condense-dom.ts`. Rename `trimDOM()` to `condenseDom()`. Remove the `tier` parameter — all rules always apply. Update the return type to `CondenseDomResult` (drop `tiersApplied`). Update imports in `snapshot-analyzer.ts` and `snapshot.ts`.

Preserve the snapshot artifact workflow: after `page.content()` is captured in `snapshot.ts`, write both the raw HTML and the condensed HTML into the snapshot run directory next to the PNG. The condensed artifact should replace the current "trimmed" artifact conceptually, but still exist as a separate file on disk so the analyzer can read it first and the user can inspect it manually.

- [ ] Rename file and function.
- [ ] Remove tier gating logic.
- [ ] Keep writing snapshot artifacts to the snapshot run directory: `page.png`, `page.html`, and `page.condensed.html` (or equivalent naming).
- [ ] Replace non-HTML placeholders (`/* [script, N chars] */`, `[icon]`) with HTML comment placeholders (`<!-- [script, N chars] -->`, `<!-- [icon] -->`).
- [ ] Update SVG collapse to extract `<title>`/`<desc>` text before collapsing.
- [ ] Keep `aria-labelledby` in the condensed output; do not strip cross-reference ARIA attributes.
- [ ] Update Rule 6 so long-value truncation exempts the full selector-relevant preserve list rather than a smaller ad hoc subset.
- [ ] Remove `componentkey` and similar from the hardcoded framework attribute list; rely on Rule 6 for long values and accept short ones as low-cost noise.
- [ ] Update `snapshot.ts` and `snapshot-analyzer.ts` so the analyzer is given both artifact paths and starts from the condensed HTML file, using the full HTML file only as a fallback for missing detail.
- [ ] Success criteria: `pnpm -C packages/libretto exec tsc --noEmit` passes. Manually run `snapshot --objective "..."` on an active session and confirm the output includes condensation stats and analysis results.

### Phase 2: Wire into extract and errors consumers

- [ ] In `extract.ts` (line 38 and 54), call `condenseDom()` on `domContent` before the length-based truncation. This replaces the blunt 30K/50K slice with structured reduction.
- [ ] In `errors.ts` (line 73), call `condenseDom()` on `htmlContent` before the 50K slice.
- [ ] Success criteria: run a workflow that triggers extraction and verify the LLM receives condensed HTML. For errors, trigger a known error condition and verify the error detection still finds the error message in the condensed DOM.

### Phase 3: Tune and measure

- [ ] Collect condensation stats (original size, condensed size, per-rule reductions) across 10+ real snapshots from different sites (LinkedIn, EMR portals, etc.).
- [ ] Identify any rules that are too aggressive (model fails to find selectors it previously found) or not aggressive enough (pages still exceed 500K after condensation).
- [ ] Specifically verify that icon-only controls named via SVG `<title>`/`<desc>` or `aria-labelledby` still remain understandable in the condensed DOM.
- [ ] Adjust thresholds (Rule 6 length threshold, Rule 9 heuristic) based on measured results.

## Future work

- **Structural deduplication:** Detect repeated sibling elements (e.g., 200 identical list items) and collapse to a representative sample. Requires tree-level analysis.
- **Depth pruning:** Truncate deeply nested subtrees. Emergency measure for extreme DOMs.
- **Objective-aware trimming:** Adjust aggressiveness based on the user's objective.
- **Browser-side capture:** Run condensation logic in `page.evaluate()` for access to computed styles and bounding rects, enabling smarter decisions (e.g., off-screen + non-interactive = collapse).
