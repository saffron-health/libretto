import { describe, expect, test } from "vitest";
import { parseCommandLine } from "../../src/v2/input/parser.js";

describe("Aff v2 command-line parser", () => {
  test("parses empty and whitespace-only command lines", () => {
    expect(parseCommandLine("")).toEqual([]);
    expect(parseCommandLine("  \n\t  ")).toEqual([]);
  });

  test("parses positional arguments, options, inline option values, and flags", () => {
    expect(
      parseCommandLine("open https://example.com --session debug --retries=2 --headless"),
    ).toEqual([
      { type: "argument", value: "open" },
      { type: "argument", value: "https://example.com" },
      { type: "option", key: "session", value: "debug" },
      { type: "option", key: "retries", value: "2" },
      { type: "option", key: "headless", value: undefined },
    ]);
  });

  test("parses short options with separated values and flags", () => {
    expect(parseCommandLine("open https://example.com -s debug -H")).toEqual([
      { type: "argument", value: "open" },
      { type: "argument", value: "https://example.com" },
      { type: "option", key: "s", value: "debug" },
      { type: "option", key: "H", value: undefined },
    ]);
  });

  test("parses quoted values and preserves whitespace inside quotes", () => {
    expect(
      parseCommandLine(
        'run "workflows/my flow.ts" --label "smoke test" --params=\'{"url":"https://example.com"}\'',
      ),
    ).toEqual([
      { type: "argument", value: "run" },
      { type: "argument", value: "workflows/my flow.ts" },
      { type: "option", key: "label", value: "smoke test" },
      { type: "option", key: "params", value: '{"url":"https://example.com"}' },
    ]);
  });

  test("parses adjacent bare and quoted value parts as one value", () => {
    expect(parseCommandLine('run ./"my flow".ts --label=smoke" test"')).toEqual([
      { type: "argument", value: "run" },
      { type: "argument", value: "./my flow.ts" },
      { type: "option", key: "label", value: "smoke test" },
    ]);
  });

  test("rejects unclosed quoted values", () => {
    expect(() => parseCommandLine('run "unterminated')).toThrow();
    expect(() => parseCommandLine("run 'unterminated")).toThrow();
  });
});
