import { describe, expect, it } from "vitest";
import { condenseDom } from "../src/cli/core/condense-dom.js";

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
});
