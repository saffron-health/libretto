import { describe, expect, test } from "vitest";
import { createBenchmarksCLIApp } from "../benchmarks/cli.js";
import {
  buildWebVoyagerPrompt,
  parseWebVoyagerRows,
  rewriteBenchmarkSkillCommands,
  selectWebVoyagerRows,
} from "../benchmarks/webVoyager/webVoyager.js";

describe("benchmarks cli", () => {
  test("renders scoped help for webVoyager run", async () => {
    const app = createBenchmarksCLIApp();
    const help = await app.run(["help", "webVoyager", "run"]);

    expect(help).toContain("Run WebVoyager benchmark cases");
    expect(help).toContain("Usage: benchmarks webVoyager run [options]");
    expect(help).toContain("--offset <value>");
    expect(help).toContain("--count <value>");
    expect(help).toContain("--seed <value>");
    expect(help).toContain("--random");
  });
});

describe("webVoyager dataset helpers", () => {
  test("parses jsonl rows", () => {
    const rows = parseWebVoyagerRows(
      [
        JSON.stringify({ id: "a", web: "https://a.test", ques: "Task A" }),
        JSON.stringify({ id: "b", web: "https://b.test", ques: "Task B", web_name: "B" }),
      ].join("\n"),
    );

    expect(rows).toEqual([
      { id: "a", web: "https://a.test", ques: "Task A", web_name: undefined },
      { id: "b", web: "https://b.test", ques: "Task B", web_name: "B" },
    ]);
  });

  test("selects a contiguous slice from offset", () => {
    const rows = [
      { id: "a", web: "https://a.test", ques: "Task A" },
      { id: "b", web: "https://b.test", ques: "Task B" },
      { id: "c", web: "https://c.test", ques: "Task C" },
    ];

    const selection = selectWebVoyagerRows(rows, { offset: 1, count: 2 });

    expect(selection).toMatchObject({
      mode: "slice",
      offset: 1,
      count: 2,
      seed: null,
      totalCaseCount: 3,
      selectedCaseCount: 2,
    });
    expect(selection.rows.map((row) => row.id)).toEqual(["b", "c"]);
  });

  test("selects a deterministic random sample", () => {
    const rows = [
      { id: "a", web: "https://a.test", ques: "Task A" },
      { id: "b", web: "https://b.test", ques: "Task B" },
      { id: "c", web: "https://c.test", ques: "Task C" },
      { id: "d", web: "https://d.test", ques: "Task D" },
    ];

    const first = selectWebVoyagerRows(rows, { random: true, count: 2, seed: 7 });
    const second = selectWebVoyagerRows(rows, { random: true, count: 2, seed: 7 });

    expect(first.rows.map((row) => row.id)).toEqual(second.rows.map((row) => row.id));
    expect(first).toMatchObject({
      mode: "random",
      count: 2,
      seed: 7,
      totalCaseCount: 4,
      selectedCaseCount: 2,
    });
  });
});

describe("webVoyager prompt and skill helpers", () => {
  test("rewrites copied skill commands to use the local cli script", () => {
    const rewritten = rewriteBenchmarkSkillCommands(
      [
        "Use the `npx libretto` CLI.",
        "",
        "npx libretto open https://example.com",
        'npx libretto snapshot --objective "inspect"',
      ].join("\n"),
    );

    expect(rewritten).toContain("Use the `pnpm -s cli` CLI.");
    expect(rewritten).toContain("pnpm -s cli open https://example.com");
    expect(rewritten).toContain('pnpm -s cli snapshot --objective "inspect"');
    expect(rewritten).not.toContain("npx libretto");
  });

  test("prompt asks for a direct final answer instead of FINAL_RESULT", () => {
    const prompt = buildWebVoyagerPrompt(
      {
        id: "sample-case",
        web: "https://example.com",
        ques: "Inspect the page and report the final title.",
        web_name: "Example",
      },
      "/tmp/libretto-benchmark-workspace",
    );

    expect(prompt).toContain("Use the libretto skill available in this workspace.");
    expect(prompt).toContain(
      "pnpm -s cli open https://example.com --headless --session webvoyager-sample-case",
    );
    expect(prompt).toContain("Your final message should directly answer the task.");
    expect(prompt).not.toContain("FINAL_RESULT");
  });
});
