import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// File tree data
// ---------------------------------------------------------------------------

const tree = [
  { type: "dir" as const, name: "app/", depth: 0 },
  { type: "file" as const, name: "server.ts", depth: 1 },
  { type: "file" as const, name: "routes.ts", depth: 1 },
  { type: "dir" as const, name: "shared/", depth: 0 },
  { type: "file" as const, name: "loginToECW.ts", depth: 1 },
  { type: "file" as const, name: "navigation.ts", depth: 1 },
  { type: "file" as const, name: "extractTable.ts", depth: 1 },
  { type: "file" as const, name: "types.ts", depth: 1 },
  { type: "dir" as const, name: "workflows/", depth: 0 },
  {
    type: "file" as const,
    name: "extractReferrals.ts",
    depth: 1,
    active: true,
  },
  { type: "file" as const, name: "syncPatients.ts", depth: 1 },
];

// ---------------------------------------------------------------------------
// Code to stream — realistic Libretto workflow
// ---------------------------------------------------------------------------

const CODE = `import { LibrettoWorkflow } from "libretto";
import { loginToECW } from "../shared/loginToECW";
import { navigateTo } from "../shared/navigation";
import { extractTable } from "../shared/extractTable";
import type { Referral } from "../shared/types";

export const extractReferrals = new LibrettoWorkflow(
  "extract-referrals",
  async (ctx) => {
    const { page } = ctx;

    await loginToECW(page);
    await navigateTo(page, "Referrals");

    const referrals = await extractTable<Referral>(
      page,
      ".referral-table",
    );

    return { referrals };
  },
);`;

// ---------------------------------------------------------------------------
// Syntax highlighting (simple token-based)
// ---------------------------------------------------------------------------

type TokenSpan = { text: string; className: string };

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "new",
  "async",
  "await",
  "return",
  "type",
]);
const TYPES = new Set(["LibrettoWorkflow", "Referral", "Referral[]"]);

function highlightLine(line: string): TokenSpan[] {
  const spans: TokenSpan[] = [];

  // String literals
  const parts = line.split(/(["'`](?:[^"'`\\]|\\.)*["'`])/g);
  for (const part of parts) {
    if (/^["'`]/.test(part)) {
      spans.push({ text: part, className: "text-amber-600/80" });
    } else {
      // Split by words
      const wordParts = part.split(/(\b\w+\b)/g);
      for (const wp of wordParts) {
        if (KEYWORDS.has(wp)) {
          spans.push({ text: wp, className: "text-purple-600/80" });
        } else if (TYPES.has(wp)) {
          spans.push({ text: wp, className: "text-teal-600/80" });
        } else if (/^\d+$/.test(wp)) {
          spans.push({ text: wp, className: "text-orange-500/80" });
        } else if (wp === "=>" || wp === "??") {
          spans.push({ text: wp, className: "text-purple-600/80" });
        } else {
          spans.push({ text: wp, className: "text-ink/60" });
        }
      }
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

function Cursor() {
  return (
    <span className="inline-block w-[5px] h-[1.1em] align-text-bottom animate-blink bg-ink/40" />
  );
}

// ---------------------------------------------------------------------------
// File tree sidebar
// ---------------------------------------------------------------------------

function FileTree({ activeFile }: { activeFile: string }) {
  return (
    <div className="flex flex-col py-1.5 px-1 select-none">
      {tree.map((entry, i) => {
        const isActive = entry.type === "file" && entry.name === activeFile;
        if (entry.type === "dir") {
          return (
            <div
              key={i}
              className="flex items-center gap-1 py-[2px] text-[9px] font-medium text-ink/45"
              style={{ paddingLeft: `${entry.depth * 8 + 2}px` }}
            >
              <span className="text-[7px] leading-none text-ink/25">›</span>
              {entry.name}
            </div>
          );
        }
        return (
          <div
            key={i}
            className={`py-[2px] text-[9px] rounded-[3px] ${
              isActive ? "bg-ink/[0.07] text-ink/65 font-medium px-1" : "text-ink/30"
            }`}
            style={{ paddingLeft: `${entry.depth * 8 + 10}px` }}
          >
            {entry.name}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor pane
// ---------------------------------------------------------------------------

function EditorPane({
  visibleText,
  streaming,
}: {
  visibleText: string;
  streaming: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lines = visibleText.split("\n");

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.scrollTop = editorRef.current.scrollHeight;
    }
  }, [visibleText]);

  return (
    <div ref={editorRef} className="flex-1 overflow-hidden py-2 px-3">
      <div className="flex">
        {/* Line numbers */}
        <div className="shrink-0 pr-3 text-right select-none w-[2ch]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {lines.map((_, i) => (
            <div key={i} className="text-[10px] leading-[1.7] text-ink/15">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {lines.map((line, i) => {
            const isLastLine = i === lines.length - 1;
            const spans = highlightLine(line);
            return (
              <div
                key={i}
                className="text-[10px] leading-[1.7] whitespace-pre font-mono min-h-[1.7em]"
              >
                {spans.map((s, j) => (
                  <span key={j} className={s.className}>
                    {s.text}
                  </span>
                ))}
                {isLastLine && streaming && <Cursor />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CodebaseAnimation() {
  const [visibleText, setVisibleText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    cancelRef.current = false;
    const id = ++runIdRef.current;

    async function run() {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const isCancelled = () => cancelRef.current || runIdRef.current !== id;

      // Reset
      setVisibleText("");
      setStreaming(false);
      await sleep(800);
      if (isCancelled()) return;

      setStreaming(true);

      // Stream in small bursts (2-3 tokens) to mimic LLM output
      const tokens = tokenize(CODE);
      let soFar = "";
      let i = 0;
      while (i < tokens.length) {
        if (isCancelled()) return;
        // Grab 1-3 tokens per tick, but always pause on newlines
        const burst = 1 + Math.floor(Math.random() * 3);
        for (let j = 0; j < burst && i < tokens.length; j++, i++) {
          soFar += tokens[i];
          if (tokens[i] === "\n") { i++; break; }
        }
        setVisibleText(soFar);
        const lastToken = tokens[i - 1] ?? "";
        const delay =
          lastToken === "\n"
            ? 40 + Math.random() * 30
            : 15 + Math.random() * 20;
        await sleep(delay);
      }

      setStreaming(false);
      await sleep(6000);
      if (isCancelled()) return;

      // Loop
      void run();
    }

    void run();
    return () => {
      cancelRef.current = true;
    };
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Title bar */}
      <div className="flex items-center px-2.5 py-1.5 border-b border-ink/[0.06] bg-ink/[0.02]">
        <div className="flex gap-1">
          <div className="size-[7px] rounded-full bg-ink/10" />
          <div className="size-[7px] rounded-full bg-ink/10" />
          <div className="size-[7px] rounded-full bg-ink/10" />
        </div>
        <span className="ml-3 text-[10px] text-ink/30 font-medium">
          extractReferrals.ts
        </span>
      </div>

      {/* Body: sidebar + editor */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[26%] shrink-0 border-r border-ink/[0.06] bg-ink/[0.015] overflow-hidden">
          <FileTree activeFile="extractReferrals.ts" />
        </div>

        {/* Editor */}
        <EditorPane visibleText={visibleText} streaming={streaming} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tokenizer — splits code into LLM-like chunks (words, operators, whitespace)
// ---------------------------------------------------------------------------

function tokenize(code: string): string[] {
  const tokens: string[] = [];
  // Match: words, string literals, operators/punctuation, whitespace runs, newlines
  const regex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\n)|( +)|(\w+)|([^\s\w])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}
