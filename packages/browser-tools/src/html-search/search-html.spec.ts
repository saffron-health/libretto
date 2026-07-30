import { describe, expect, test } from "vitest";
import { formatHtmlForSearch, searchFormattedHtml } from "./search-html.js";

describe("HTML search", () => {
  test("formats condensed HTML before searching", () => {
    const formatted = formatHtmlForSearch(
      '<!doctype html><html><body><main><p data-testid="target">Needle</p></main></body></html>',
    );

    expect(formatted).toContain('<p data-testid="target">');
    expect(formatted).toContain("Needle");
  });

  test("returns merged matching regions with context", () => {
    const formatted = [
      "<html>",
      "<body>",
      "<main>",
      "<section>",
      "<h1>Heading</h1>",
      '<p class="target">Needle</p>',
      "<p>More content</p>",
      "</section>",
      "</main>",
      "</body>",
      "</html>",
    ].join("\n");

    const matches = searchFormattedHtml(formatted, "Needle", 2);

    expect(matches).toEqual([
      {
        startLine: 4,
        endLine: 8,
        lines: [
          "<section>",
          "<h1>Heading</h1>",
          '<p class="target">Needle</p>',
          "<p>More content</p>",
          "</section>",
        ],
      },
    ]);
  });

  test("limits matching regions before adding context", () => {
    const formatted = Array.from(
      { length: 12 },
      (_value, index) => `<p>Needle ${index}</p>`,
    ).join("\n");

    const matches = searchFormattedHtml(formatted, "Needle", 0, 8);

    expect(matches).toEqual([
      {
        startLine: 1,
        endLine: 8,
        lines: Array.from(
          { length: 8 },
          (_value, index) => `<p>Needle ${index}</p>`,
        ),
      },
    ]);
  });
});
