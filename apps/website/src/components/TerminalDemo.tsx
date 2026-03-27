import { useEffect, useState, useRef } from "react";
import { RefreshIcon } from "../icons";

type Line =
  | { type: "user"; text: string }
  | { type: "thinking"; done: boolean }
  | { type: "tool"; label: string; done: boolean }
  | { type: "agent"; text: string };

const USER_MESSAGE =
  "Open LinkedIn and send connection requests to the top 5 people who viewed my profile";

function Cursor({ dark }: { dark?: boolean }) {
  return (
    <span
      className={`inline-block w-[7px] h-[1.15em] align-text-bottom animate-blink ${dark ? "bg-cream/50" : "bg-ink/50"}`}
    />
  );
}

function ThinkingLine({ done }: { done: boolean }) {
  return (
    <div className="flex items-center gap-2 text-ink/25">
      {done ? (
        <span className="text-teal-600/60">✓</span>
      ) : (
        <span className="animate-spin-slow text-ink/20">◐</span>
      )}
      <span>Thinking</span>
      {done && <span className="text-ink/15">▶</span>}
    </div>
  );
}

function ToolLine({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 text-ink/25">
      {done ? (
        <span className="text-teal-600/60">✓</span>
      ) : (
        <span className="animate-spin-slow text-ink/20">◐</span>
      )}
      <span>{label}</span>
    </div>
  );
}

export function TerminalDemo() {
  const [lines, setLines] = useState<Line[]>([]);
  const [promptText, setPromptText] = useState("");
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const [streamingAgent, setStreamingAgent] = useState("");
  const [isStreamingAgent, setIsStreamingAgent] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, promptText, streamingAgent]);

  useEffect(() => {
    let cancelled = false;

    setLines([]);
    setPromptText("");
    setPromptSubmitted(false);
    setStreamingAgent("");
    setIsStreamingAgent(false);
    setAnimationDone(false);

    async function run() {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      await sleep(1000);

      // User types char by char
      for (let c = 0; c <= USER_MESSAGE.length; c++) {
        if (cancelled) return;
        setPromptText(USER_MESSAGE.slice(0, c));
        await sleep(30);
      }

      await sleep(500);
      if (cancelled) return;

      // Submit
      setPromptSubmitted(true);
      setPromptText("");
      setLines([{ type: "user", text: USER_MESSAGE }]);

      await sleep(300);
      if (cancelled) return;

      // Thinking (spinning)
      setLines((prev) => [...prev, { type: "thinking", done: false }]);
      await sleep(1800);
      if (cancelled) return;

      // Thinking done
      setLines((prev) => prev.map((l) => (l.type === "thinking" ? { ...l, done: true } : l)));

      // Tool: bash — open
      await sleep(400);
      if (cancelled) return;
      setLines((prev) => [
        ...prev,
        {
          type: "tool",
          label: "bash: npx libretto open https://linkedin.com --headed",
          done: false,
        },
      ]);
      await sleep(1400);
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => (i === prev.length - 1 && l.type === "tool" ? { ...l, done: true } : l)),
      );

      // Tool: bash — snapshot
      await sleep(300);
      if (cancelled) return;
      setLines((prev) => [
        ...prev,
        {
          type: "tool",
          label: 'bash: npx libretto snapshot --objective "Find profile viewers"',
          done: false,
        },
      ]);
      await sleep(1200);
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => (i === prev.length - 1 && l.type === "tool" ? { ...l, done: true } : l)),
      );

      // Tool: bash — exec click
      await sleep(300);
      if (cancelled) return;
      setLines((prev) => [
        ...prev,
        {
          type: "tool",
          label: 'bash: npx libretto exec "await page.locator(…).click()"',
          done: false,
        },
      ]);
      await sleep(900);
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => (i === prev.length - 1 && l.type === "tool" ? { ...l, done: true } : l)),
      );

      // Tool: bash — exec count
      await sleep(300);
      if (cancelled) return;
      setLines((prev) => [
        ...prev,
        {
          type: "tool",
          label: "bash: npx libretto exec \"return await page.locator('.profile-card').count()\"",
          done: false,
        },
      ]);
      await sleep(800);
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => (i === prev.length - 1 && l.type === "tool" ? { ...l, done: true } : l)),
      );

      // Tool: write file
      await sleep(300);
      if (cancelled) return;
      setLines((prev) => [
        ...prev,
        {
          type: "tool",
          label: "write: linkedin_connections.ts",
          done: false,
        },
      ]);
      await sleep(1000);
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => (i === prev.length - 1 && l.type === "tool" ? { ...l, done: true } : l)),
      );

      // Agent streams response word by word
      await sleep(400);
      if (cancelled) return;
      const agentText =
        "Created linkedin_connections.ts — a workflow that opens LinkedIn, finds your profile viewers, and sends connection requests to the top 5.\n\nRun it anytime:\n  npx libretto run ./linkedin_connections.ts main --headless";
      setIsStreamingAgent(true);
      const words = agentText.split(/(?<=\s)/);
      let so_far = "";
      for (const word of words) {
        if (cancelled) return;
        so_far += word;
        setStreamingAgent(so_far);
        await sleep(35 + Math.random() * 30);
      }
      await sleep(200);
      setIsStreamingAgent(false);
      setStreamingAgent("");
      setLines((prev) => [...prev, { type: "agent", text: agentText }]);
      setAnimationDone(true);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [animationKey]);

  return (
    <div className="mx-auto max-w-[600px] mt-16">
      <div className="rounded-xl border border-ink/[0.08] bg-white shadow-lg overflow-hidden flex flex-col font-mono text-[13px]">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-ink/[0.06] bg-ink/[0.02]">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-ink/10" />
            <div className="size-2.5 rounded-full bg-ink/10" />
            <div className="size-2.5 rounded-full bg-ink/10" />
          </div>
          <img src="/claude-code-logo.svg" alt="Claude Code" className="h-3.5 w-auto opacity-70" />
          {/* Reset button */}
          <button
            type="button"
            onClick={() => setAnimationKey((k) => k + 1)}
            className={`p-1 rounded-md text-ink/30 hover:text-ink/60 hover:bg-ink/[0.05] transition-all duration-300 cursor-pointer ${animationDone ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            aria-label="Replay animation"
          >
            <RefreshIcon className="size-3.5" />
          </button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          className="px-5 pt-5 pb-3 h-[500px] overflow-y-auto flex flex-col gap-2 leading-[1.65]"
        >
          <div className="flex-1" />

          {lines.map((line, i) => {
            if (line.type === "user") {
              return (
                <div key={i} className="flex gap-3 items-start mb-2">
                  <div className="w-[3px] shrink-0 self-stretch bg-teal-500" />
                  <span className="text-teal-700">{line.text}</span>
                </div>
              );
            }
            if (line.type === "thinking") {
              return <ThinkingLine key={i} done={line.done} />;
            }
            if (line.type === "tool") {
              return <ToolLine key={i} label={line.label} done={line.done} />;
            }
            if (line.type === "agent") {
              return (
                <div key={i} className="text-ink/70 whitespace-pre-wrap mt-1">
                  {line.text}
                </div>
              );
            }
            return null;
          })}

          {/* Streaming agent text */}
          {isStreamingAgent && (
            <div className="text-ink/70 whitespace-pre-wrap mt-1">
              {streamingAgent}
              <Cursor />
            </div>
          )}
        </div>

        {/* Prompt box */}
        <div className="border-t border-ink/[0.1] px-5 py-2.5 text-[12.5px]">
          <div className="min-h-[24px] flex items-center text-ink/70">
            {!promptSubmitted ? (
              <>
                <span>{promptText}</span>
                <Cursor />
              </>
            ) : (
              <span className="text-ink/20">Ask a question…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
