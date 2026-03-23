import { describe, expect, it } from "vitest";
import { condenseDom } from "../src/shared/condense-dom/condense-dom.js";

describe("condenseDom SVG collapsing", () => {
  it("does not invent preserved attributes from similarly named attributes", () => {
    const result = condenseDom(
      `<svg data-id="fake" data-testid="icon"><title>Label</title><path d="M0 0" /></svg>`,
    );

    expect(result.html).toContain(`data-testid="icon"`);
    expect(result.html).not.toContain(` id="fake"`);
  });

  it("escapes promoted SVG labels so output remains valid HTML", () => {
    const result = condenseDom(
      `<svg><title>5" widget & more</title><path d="M0 0" /></svg>`,
    );

    expect(result.html).toBe(
      `<svg aria-label="5&quot; widget &amp; more"><!-- [icon] --></svg>`,
    );
  });

  it("preserves literal dollar sequences inside pre blocks", () => {
    const html = '<pre>const sample = "$& $\' $` $$";</pre>';
    const result = condenseDom(html);

    expect(result.html).toBe(html);
  });

  it("removes HTML comments entirely", () => {
    const result = condenseDom(
      `<div>Hello</div><!-- hidden --><span>World</span>`,
    );

    expect(result.html).toBe(`<div>Hello</div><span>World</span>`);
  });
});

describe("condenseDom attribute allowlist", () => {
  it("drops unknown framework attrs while preserving trusted state and selector attrs", () => {
    const result = condenseDom(
      `<button componentkey="abc" data-view-tracking-scope="feed" data-testid="save-btn" aria-label="Save" tabindex="-1" disabled type="button">Save</button>`,
    );

    expect(result.html).toBe(
      `<button data-testid="save-btn" aria-label="Save" tabindex="-1" disabled type="button">Save</button>`,
    );
  });

  it("filters long class attributes instead of inventing placeholder values", () => {
    const result = condenseDom(
      `<div class="search-input ${"x".repeat(240)} a1b2c3d4">Hello</div>`,
    );

    expect(result.html).toBe(`<div class="search-input">Hello</div>`);
    expect(result.html).not.toContain("[240 chars]");
  });

  it("drops class entirely when only obfuscated tokens remain", () => {
    const result = condenseDom(`<div class="abc123 _2fde8c88">Hello</div>`);

    expect(result.html).toBe(`<div>Hello</div>`);
  });

  it("normalizes very long URL attrs instead of deleting them", () => {
    const longUrl =
      "https://www.linkedin.com/feed/?trk=feed_main&" + "x=".repeat(120);

    const result = condenseDom(`<a href="${longUrl}">Feed</a>`);

    expect(result.html).toContain(
      `href="https://www.linkedin.com/feed/?[query omitted]"`,
    );
  });

  it("sanitizes dangerous URL schemes even when the URL is short", () => {
    const result = condenseDom(
      `<a href="javascript:alert(1)">Click</a><img src="data:text/plain,hello" />`,
    );

    expect(result.html).toContain(`href="javascript:[omitted]"`);
    expect(result.html).toContain(`src="data:[omitted]"`);
  });

  it("preserves existing html-escaped attribute values without double escaping", () => {
    const result = condenseDom(
      `<img src="https://example.com/image?x=1&amp;y=2" alt="Example &amp; more" />`,
    );

    expect(result.html).toBe(
      `<img src="https://example.com/image?x=1&amp;y=2" alt="Example &amp; more" />`,
    );
    expect(result.html).not.toContain("&amp;amp;");
  });

  it("preserves hidden ui signals while dropping empty trusted attrs", () => {
    const result = condenseDom(
      `<dialog hidden aria-label="" aria-describedby="" title=""><button>Open</button></dialog>`,
    );

    expect(result.html).toBe(`<dialog hidden><button>Open</button></dialog>`);
  });

  it("keeps all aria attrs and autocomplete", () => {
    const result = condenseDom(
      `<input aria-current="page" aria-autocomplete="list" autocomplete="email" fetchpriority="high" />`,
    );

    expect(result.html).toBe(
      `<input aria-current="page" aria-autocomplete="list" autocomplete="email" />`,
    );
  });

  it("replaces script and style contents without emitting synthetic HTML comments", () => {
    const result = condenseDom(
      `<script type="application/json">{"x":"<!-- keep as text -->"}</script><style>.card { color: red; }</style>`,
    );

    expect(result.html).toBe(
      `<script type="application/json">[JSON data, 8 chars]</script><style>[CSS, 21 chars]</style>`,
    );
    expect(result.html).not.toContain("<!--");
  });

  it("matches spaced script closing tags and strips unsafe short URL schemes", () => {
    const result = condenseDom(
      `<script>console.log("x")</script \t\n bar><a href="data:text/html,hello">Link</a><a href="vbscript:msgbox(1)">Legacy</a>`,
    );

    expect(result.html).toContain(`<script>[script, 16 chars]</script`);
    expect(result.html).toContain(`href="data:[omitted]"`);
    expect(result.html).toContain(`href="vbscript:[omitted]"`);
  });

  it("strips unterminated HTML comment starts entirely", () => {
    const result = condenseDom(`<div>keep</div><!-- truncated comment`);

    expect(result.html).toBe(`<div>keep</div>`);
  });
});
