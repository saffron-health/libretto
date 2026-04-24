import { describe, expect } from "vitest";
import { test } from "./fixtures.js";

describe("persistent exec sandbox", () => {
  test("variable defined in one exec is available in the next", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-var";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(`exec "const x = 42" --session ${session}`);
    const result = await librettoCli(`exec "x" --session ${session}`);
    expect(result.stdout.trim()).toBe("42");
  }, 60_000);

  test("function defined in one exec is callable in the next", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-fn";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(
      `exec "function double(n) { return n * 2 }" --session ${session}`,
    );
    const result = await librettoCli(`exec "double(21)" --session ${session}`);
    expect(result.stdout.trim()).toBe("42");
  }, 60_000);

  test("class defined in one exec is usable in the next", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-class";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(
      `exec "class Adder { add(a, b) { return a + b } }" --session ${session}`,
    );
    const result = await librettoCli(
      `exec "new Adder().add(1, 2)" --session ${session}`,
    );
    expect(result.stdout.trim()).toBe("3");
  }, 60_000);

  test("destructured variables persist across execs", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-destructure";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(
      `exec "const { a, b } = { a: 1, b: 2 }" --session ${session}`,
    );
    const result = await librettoCli(`exec "a + b" --session ${session}`);
    expect(result.stdout.trim()).toBe("3");
  }, 60_000);

  test("async function and top-level await persist across execs", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-async";
    const url = await writeHtml("Async Persist");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(
      `exec "async function getTitle() { return await page.title() }" --session ${session}`,
    );
    const result = await librettoCli(
      `exec "await getTitle()" --session ${session}`,
    );
    expect(result.stdout.trim()).toBe("Async Persist");
  }, 60_000);

  test("readonly-exec has its own persistent context", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-readonly";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(`readonly-exec "const y = 99" --session ${session}`);
    const result = await librettoCli(`readonly-exec "y" --session ${session}`);
    expect(result.stdout.trim()).toBe("99");
  }, 60_000);

  test("error in one exec does not break subsequent execs", async ({
    librettoCli,
    writeHtml,
  }) => {
    const session = "persist-error-recovery";
    const url = await writeHtml("Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const errResult = await librettoCli(
      `exec "undeclaredVar" --session ${session}`,
    );
    expect(errResult.stderr).not.toBe("");

    const result = await librettoCli(`exec "1 + 1" --session ${session}`);
    expect(result.stdout.trim()).toBe("2");
  }, 60_000);
});
