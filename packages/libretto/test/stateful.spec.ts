import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

const SNAPSHOT_PRESETS = ["codex", "claude", "gemini"] as const;

async function writeFakeAnalyzer(workspaceDir: string): Promise<string> {
  const analyzerPath = join(workspaceDir, "fake-analyzer.mjs");
  await writeFile(
    analyzerPath,
    `
import { writeFileSync } from "node:fs";

const preset = process.argv[2] ?? "unknown";
const args = process.argv.slice(3);
for await (const _chunk of process.stdin) {
  // Consume stdin so test analyzers behave like the real CLIs.
}
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const payload = JSON.stringify({
  answer: "snapshot-ok-" + preset,
  selectors: [],
  notes: "",
});

if (outputPath) {
  writeFileSync(outputPath, payload, "utf8");
}
process.stdout.write(payload);
`,
    "utf8",
  );
  return analyzerPath;
}

async function writeRecordingAnalyzer(
  workspaceDir: string,
): Promise<{ analyzerPath: string; recordPath: string }> {
  const analyzerPath = join(workspaceDir, "recording-analyzer.mjs");
  const recordPath = join(workspaceDir, "recording-analyzer-output.json");
  await writeFile(
    analyzerPath,
    `
import { writeFileSync } from "node:fs";

const preset = process.argv[2] ?? "unknown";
const recordPath = process.argv[3];
const args = process.argv.slice(4);
let stdin = "";
for await (const chunk of process.stdin) {
  stdin += chunk;
}

const lines = stdin
  .split(/\\r?\\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return line;
    }
  });

writeFileSync(
  recordPath,
  JSON.stringify({ preset, args, stdin, lines }, null, 2),
  "utf8",
);

const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const payload = JSON.stringify({
  answer: "snapshot-ok-" + preset,
  selectors: [],
  notes: "",
});

if (outputPath) {
  writeFileSync(outputPath, payload, "utf8");
}
process.stdout.write(payload);
`,
    "utf8",
  );
  return { analyzerPath, recordPath };
}

async function startStaticHtmlServer(
  html: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected static test server to bind to an ephemeral port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli }) => {
    const result = await librettoCli("ai configure");
    expect(result.stdout).toContain("No AI config set.");
  });

  test("configures, shows, and clears AI config", async ({
    librettoCli,
  }) => {
    const configure = await librettoCli("ai configure codex");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("AI preset: codex");

    const clear = await librettoCli("ai configure --clear");
    expect(clear.stdout).toContain("Cleared AI config:");

    const showAfterClear = await librettoCli("ai configure");
    expect(showAfterClear.stdout).toContain("No AI config set.");
  });

  test("configures gemini AI preset", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure gemini");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("AI preset: gemini");
  });

  test("configures custom AI command prefix and shows it", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    const configure = await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "custom-prefix"`,
    );
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("AI preset: codex");
    expect(show.stdout).toContain(
      `Command prefix: ${process.execPath} ${analyzerPath} custom-prefix`,
    );
  });

  for (const preset of SNAPSHOT_PRESETS) {
    test(`configures ${preset} and snapshot analysis works`, async ({
      librettoCli,
      workspaceDir,
    }) => {
      const session = `snapshot-${preset}`;
      const analyzerPath = await writeFakeAnalyzer(workspaceDir);
      await librettoCli(
        `ai configure ${preset} -- "${process.execPath}" "${analyzerPath}" "${preset}"`,
      );

      const opened = await librettoCli(
        `open https://example.com --headless --session ${session}`,
      );
      expect(opened.stdout).toContain("Browser open");

      const snapshot = await librettoCli(
        `snapshot --objective "Find heading" --context "Preset ${preset} snapshot smoke test" --session ${session}`,
      );
      expect(snapshot.stdout).toContain("Interpretation:");
      expect(snapshot.stdout).toContain(`Answer: snapshot-ok-${preset}`);
    }, 45_000);
  }

  test("snapshot passes inline full DOM and direct image input to codex", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-inline-codex";
    const { analyzerPath, recordPath } = await writeRecordingAnalyzer(workspaceDir);
    const server = await startStaticHtmlServer(
      [
        "<!doctype html>",
        "<html>",
        "<body>",
        '  <main componentkey="full-dom-marker">',
        '    <button data-testid="cta" aria-label="Call to action">Continue</button>',
        "  </main>",
        "</body>",
        "</html>",
      ].join("\n"),
    );

    try {
      await librettoCli(
        `ai configure codex -- "${process.execPath}" "${analyzerPath}" "codex" "${recordPath}"`,
      );

      const opened = await librettoCli(
        `open ${server.url} --headless --session ${session}`,
      );
      expect(opened.stdout).toContain("Browser open");

      const snapshot = await librettoCli(
        `snapshot --objective "Find the call to action button" --context "Codex inline snapshot regression" --session ${session}`,
      );
      expect(snapshot.stdout).toContain("Answer: snapshot-ok-codex");

      const rawRecord = await readFile(recordPath, "utf8");
      const record = JSON.parse(rawRecord) as {
        args: string[];
        stdin: string;
      };

      expect(record.args).toContain("--image");
      expect(record.args).not.toContain("--output-format");
      expect(record.stdin).toContain("Selected HTML snapshot: full DOM");
      expect(record.stdin).toContain(
        "Full DOM is within 75% of the estimated context window",
      );
      expect(record.stdin).toContain('componentkey="full-dom-marker"');
      expect(record.stdin).toContain("HTML snapshot (full DOM):");
      expect(record.stdin).not.toContain(
        "The following snapshot files are available",
      );
    } finally {
      await server.close();
    }
  }, 45_000);

  test("snapshot passes structured image input to claude and uses condensed DOM when full DOM is too large", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-inline-claude";
    const { analyzerPath, recordPath } = await writeRecordingAnalyzer(workspaceDir);
    const repeatedCard = `<section componentkey="removed-by-condense" class="card ${"x".repeat(180)}"><button data-testid="card-action" aria-label="Card action">Inspect</button></section>`;
    const server = await startStaticHtmlServer(
      `<!doctype html><html><body>${repeatedCard.repeat(5500)}</body></html>`,
    );

    try {
      await librettoCli(
        `ai configure claude -- "${process.execPath}" "${analyzerPath}" "claude" "${recordPath}"`,
      );

      const opened = await librettoCli(
        `open ${server.url} --headless --session ${session}`,
      );
      expect(opened.stdout).toContain("Browser open");

      const snapshot = await librettoCli(
        `snapshot --objective "Find the repeated card action button" --context "Claude inline snapshot regression" --session ${session}`,
      );
      expect(snapshot.stdout).toContain("Answer: snapshot-ok-claude");

      const rawRecord = await readFile(recordPath, "utf8");
      const record = JSON.parse(rawRecord) as {
        args: string[];
        lines: Array<{
          type?: string;
          message?: {
            role?: string;
            content?: Array<
              | { type: "text"; text: string }
              | {
                  type: "image";
                  source: {
                    type: string;
                    media_type: string;
                    data: string;
                  };
                }
            >;
          };
        }>;
      };

      expect(record.args).toEqual(
        expect.arrayContaining([
          "--verbose",
          "--output-format",
          "stream-json",
          "--input-format",
          "stream-json",
        ]),
      );

      const userMessage = record.lines.find((line) => line.type === "user");
      expect(userMessage?.message?.role).toBe("user");
      expect(Array.isArray(userMessage?.message?.content)).toBe(true);

      const contentBlocks = userMessage?.message?.content ?? [];
      const textBlock = contentBlocks.find(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      );
      const imageBlock = contentBlocks.find(
        (block): block is {
          type: "image";
          source: { type: string; media_type: string; data: string };
        } => block.type === "image",
      );

      expect(textBlock?.text).toContain("Selected HTML snapshot: condensed DOM");
      expect(textBlock?.text).toContain(
        "Full DOM exceeds 75% of the estimated context window",
      );
      expect(textBlock?.text).toContain("HTML snapshot (condensed DOM):");
      expect(textBlock?.text).not.toContain(
        'componentkey="removed-by-condense"',
      );
      expect(imageBlock?.source.type).toBe("base64");
      expect(imageBlock?.source.media_type).toBe("image/png");
      expect(imageBlock?.source.data.length).toBeGreaterThan(100);
    } finally {
      await server.close();
    }
  }, 60_000);

  test("runs snapshot analysis when only --objective is provided", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-objective-only";
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "objective-only"`,
    );

    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.stdout).toContain("Browser open");

    const snapshot = await librettoCli(
      `snapshot --objective "Find heading" --session ${session}`,
    );
    expect(snapshot.stdout).toContain("Interpretation:");
    expect(snapshot.stdout).toContain("Answer: snapshot-ok-objective-only");
  }, 45_000);

  test("shows a clear error when --context is provided without --objective", async ({
    librettoCli,
  }) => {
    const session = "snapshot-context-only";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(
      `snapshot --context "extra context only" --session ${session}`,
    );
    expect(snapshot.stderr).toContain(
      "Couldn't run analysis: --objective is required when providing --context.",
    );
  }, 45_000);

  test("shows a clear error when opening an already active session", async ({
    librettoCli,
  }) => {
    const session = "already-open";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    const secondOpen = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(secondOpen.stderr).toContain(
      `Session "${session}" is already open and connected to`,
    );
    expect(secondOpen.stderr).toContain(
      `libretto-cli close --session ${session}`,
    );
  }, 45_000);

  test("prints no-op message when closing a session with no browser", async ({
    librettoCli,
  }) => {
    const session = "no-browser-session";
    const result = await librettoCli(`close --session ${session}`);
    expect(result.stdout).toContain(
      `No browser running for session "${session}".`,
    );
  });

  test("prints no-op message when closing all sessions and none exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --all");
    expect(result.stdout).toContain("No browser sessions found.");
  });

  test("rejects close --force without --all", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --force");
    expect(result.stderr).toContain("Usage: libretto-cli close --all [--force]");
  });

  test("close --all closes active sessions", async ({
    librettoCli,
  }) => {
    const sessionOne = "close-all-session-one";
    const sessionTwo = "close-all-session-two";

    await librettoCli(
      `open https://example.com --headless --session ${sessionOne}`,
    );
    await librettoCli(
      `open https://example.com --headless --session ${sessionTwo}`,
    );

    const closeAll = await librettoCli("close --all");
    expect(closeAll.stdout).toContain("Closed 2 session(s).");

    const closeOne = await librettoCli(`close --session ${sessionOne}`);
    expect(closeOne.stdout).toContain(
      `No browser running for session "${sessionOne}".`,
    );

    const closeTwo = await librettoCli(`close --session ${sessionTwo}`);
    expect(closeTwo.stdout).toContain(
      `No browser running for session "${sessionTwo}".`,
    );
  }, 45_000);

  test("reads and clears network logs for a live session", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "network-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.goto('https://example.com/?network=one'); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`network --session ${session} --last 5`);
    await evaluate(view.stdout).toMatch(
      "Shows at least one network request result for the session.",
    );

    const clear = await librettoCli(`network --session ${session} --clear`);
    expect(clear.stdout).toContain("Network log cleared.");
  }, 60_000);

  test("reads and clears action logs for a live session", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "actions-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.reload(); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`actions --session ${session} --last 5`);
    await evaluate(view.stdout).toMatch(
      "Shows at least one action result for the session.",
    );

    const clear = await librettoCli(`actions --session ${session} --clear`);
    expect(clear.stdout).toContain("Action log cleared.");
  }, 60_000);
});
