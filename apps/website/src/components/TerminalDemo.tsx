import { useEffect, useState, useRef, useCallback } from "react";
import { RefreshIcon } from "../icons";
import { workflowExamples, type WorkflowExample } from "./workflowExamples";

type Line =
  | { type: "user"; text: string }
  | { type: "thinking"; done: boolean }
  | { type: "tool"; label: string; done: boolean }
  | { type: "agent"; text: string }
  | { type: "interrupted" };

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

function useTerminalAnimation(
  example: WorkflowExample,
  animationKey: number,
  skipTyping: boolean,
) {
  const [lines, setLines] = useState<Line[]>([]);
  const [promptText, setPromptText] = useState("");
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const [streamingAgent, setStreamingAgent] = useState("");
  const [isStreamingAgent, setIsStreamingAgent] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const generationRef = useRef(0);
  const streamingRef = useRef("");

  const interrupt = useCallback(() => {
    if (animationDone) return;
    generationRef.current++;

    // Commit any partial streaming text
    const partial = streamingRef.current;
    setIsStreamingAgent(false);
    setStreamingAgent("");
    streamingRef.current = "";

    setLines((prev) => {
      const next = [...prev];
      // Mark any in-progress thinking/tool as done
      for (let i = 0; i < next.length; i++) {
        const l = next[i];
        if ((l.type === "thinking" || l.type === "tool") && !l.done) {
          next[i] = { ...l, done: true };
        }
      }
      if (partial) {
        next.push({ type: "agent", text: partial });
      }
      next.push({ type: "interrupted" });
      return next;
    });

    setPromptSubmitted(true);
    setAnimationDone(true);
  }, [animationDone]);

  useEffect(() => {
    const gen = ++generationRef.current;
    streamingRef.current = "";

    setLines([]);
    setPromptText("");
    setPromptSubmitted(false);
    setStreamingAgent("");
    setIsStreamingAgent(false);
    setAnimationDone(false);

    async function run() {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const isCancelled = () => generationRef.current !== gen;

      if (skipTyping) {
        setPromptSubmitted(true);
        setPromptText("");
        setLines([{ type: "user", text: example.userMessage }]);
      } else {
        await sleep(600);

        for (let c = 0; c <= example.userMessage.length; c++) {
          if (isCancelled()) return;
          setPromptText(example.userMessage.slice(0, c));
          await sleep(25);
        }

        await sleep(500);
        if (isCancelled()) return;

        setPromptSubmitted(true);
        setPromptText("");
        setLines([{ type: "user", text: example.userMessage }]);
      }

      await sleep(300);
      if (isCancelled()) return;

      setLines((prev) => [...prev, { type: "thinking", done: false }]);
      await sleep(example.thinkDurationMs);
      if (isCancelled()) return;

      setLines((prev) =>
        prev.map((l) => (l.type === "thinking" ? { ...l, done: true } : l)),
      );

      for (const tool of example.tools) {
        await sleep(300);
        if (isCancelled()) return;
        setLines((prev) => [
          ...prev,
          { type: "tool", label: tool.label, done: false },
        ]);
        await sleep(tool.durationMs);
        if (isCancelled()) return;
        setLines((prev) =>
          prev.map((l, i) =>
            i === prev.length - 1 && l.type === "tool"
              ? { ...l, done: true }
              : l,
          ),
        );
      }

      await sleep(400);
      if (isCancelled()) return;
      setIsStreamingAgent(true);
      const words = example.agentResponse.split(/(?<=\s)/);
      let soFar = "";
      for (const word of words) {
        if (isCancelled()) return;
        soFar += word;
        streamingRef.current = soFar;
        setStreamingAgent(soFar);
        await sleep(35 + Math.random() * 30);
      }
      await sleep(200);
      if (isCancelled()) return;
      setIsStreamingAgent(false);
      setStreamingAgent("");
      streamingRef.current = "";
      setLines((prev) => [
        ...prev,
        { type: "agent", text: example.agentResponse },
      ]);
      setAnimationDone(true);
    }

    void run();
    return () => {
      generationRef.current++;
    };
  }, [example, animationKey, skipTyping]);

  return {
    lines,
    promptText,
    promptSubmitted,
    streamingAgent,
    isStreamingAgent,
    animationDone,
    interrupt,
  };
}

const CTA_RESPONSE = "To try Libretto, run `npm create libretto@latest`";

export function TerminalDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [skipTyping, setSkipTyping] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [extraLines, setExtraLines] = useState<Line[]>([]);
  const [extraStreaming, setExtraStreaming] = useState("");
  const [isExtraStreaming, setIsExtraStreaming] = useState(false);
  const extraGenRef = useRef(0);
  const extraStreamingRef = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const example = workflowExamples[activeIndex];

  const {
    lines,
    promptText,
    promptSubmitted,
    streamingAgent,
    isStreamingAgent,
    animationDone,
    interrupt,
  } = useTerminalAnimation(example, animationKey, skipTyping);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, promptText, streamingAgent, extraLines, extraStreaming]);

  // Focus input when animation finishes
  useEffect(() => {
    if (animationDone && inputRef.current) {
      inputRef.current.focus();
    }
  }, [animationDone]);

  const handleTabClick = useCallback(
    (index: number) => {
      if (index === activeIndex) return;
      setActiveIndex(index);
      setSkipTyping(true);
      setAnimationKey((k) => k + 1);
      extraGenRef.current++;
      setExtraLines([]);
      setExtraStreaming("");
      setIsExtraStreaming(false);
      setUserInput("");
    },
    [activeIndex],
  );

  const interruptExtraStreaming = useCallback(() => {
    if (!isExtraStreaming) return;
    extraGenRef.current++;
    const partial = extraStreamingRef.current;
    setIsExtraStreaming(false);
    setExtraStreaming("");
    extraStreamingRef.current = "";
    setExtraLines((prev) => {
      const next = [...prev];
      if (partial) {
        next.push({ type: "agent", text: partial });
      }
      next.push({ type: "interrupted" });
      return next;
    });
  }, [isExtraStreaming]);

  const handleUserSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = userInput.trim();
      if (!text) return;
      setUserInput("");

      // Interrupt main animation if still running
      if (!animationDone) {
        interrupt();
      }

      // Interrupt extra streaming if running
      interruptExtraStreaming();

      // Add user message
      setExtraLines((prev) => [...prev, { type: "user", text }]);

      // Stream CTA response
      const gen = ++extraGenRef.current;
      extraStreamingRef.current = "";

      async function stream() {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const isStale = () => extraGenRef.current !== gen;
        await sleep(400);
        if (isStale()) return;
        setIsExtraStreaming(true);
        const words = CTA_RESPONSE.split(/(?<=\s)/);
        let soFar = "";
        for (const word of words) {
          if (isStale()) return;
          soFar += word;
          extraStreamingRef.current = soFar;
          setExtraStreaming(soFar);
          await sleep(35 + Math.random() * 30);
        }
        await sleep(200);
        if (isStale()) return;
        setIsExtraStreaming(false);
        setExtraStreaming("");
        extraStreamingRef.current = "";
        setExtraLines((prev) => [
          ...prev,
          { type: "agent", text: CTA_RESPONSE },
        ]);
      }
      void stream();
    },
    [userInput, animationDone, interrupt, interruptExtraStreaming],
  );

  return (
    <div className="mx-auto max-w-[600px] mt-16">
      <div className="rounded-xl border border-ink/[0.08] bg-white shadow-lg overflow-hidden flex flex-col font-mono text-[13px]">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-ink/[0.02]">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-ink/10" />
            <div className="size-2.5 rounded-full bg-ink/10" />
            <div className="size-2.5 rounded-full bg-ink/10" />
          </div>
          <div className="flex items-center gap-1.5">
            <img
              src="/claude-code-logo.svg"
              alt="Claude Code"
              className="h-3.5 w-auto opacity-70"
            />
            <span className="font-sans text-[13px] font-[450] text-ink/50">
              Claude Code
            </span>
          </div>
          {/* Reset button */}
          <button
            type="button"
            onClick={() => {
              extraGenRef.current++;
              setExtraLines([]);
              setExtraStreaming("");
              setIsExtraStreaming(false);
              setUserInput("");
              setAnimationKey((k) => k + 1);
            }}
            className={`p-1 rounded-md text-ink/30 hover:text-ink/60 hover:bg-ink/[0.05] transition-all duration-300 cursor-pointer ${animationDone ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            aria-label="Replay animation"
          >
            <RefreshIcon className="size-3.5" />
          </button>
        </div>

        {/* macOS-style tab bar */}
        <div className="flex border-y border-ink/[0.08] bg-ink/[0.04]">
          {workflowExamples.map((ex, i) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => handleTabClick(i)}
              className={`flex-1 px-3 py-1.5 text-[11.5px] font-sans font-medium transition-colors duration-100 ease-out whitespace-nowrap border-r border-ink/[0.08] last:border-r-0 ${
                i === activeIndex
                  ? "bg-white text-ink/70"
                  : "text-ink/35 hover:text-ink/50 hover:bg-ink/[0.02]"
              }`}
            >
              {ex.tab}
            </button>
          ))}
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
            if (line.type === "interrupted") {
              return (
                <div key={i} className="text-red-400 text-[12px] mb-1">
                  Interrupted
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

          {/* Extra lines from user input */}
          {extraLines.map((line, i) => {
            if (line.type === "user") {
              return (
                <div key={`extra-${i}`} className="flex gap-3 items-start mb-2">
                  <div className="w-[3px] shrink-0 self-stretch bg-teal-500" />
                  <span className="text-teal-700">{line.text}</span>
                </div>
              );
            }
            if (line.type === "agent") {
              return (
                <div
                  key={`extra-${i}`}
                  className="text-ink/70 whitespace-pre-wrap mt-1"
                >
                  {line.text}
                </div>
              );
            }
            if (line.type === "interrupted") {
              return (
                <div
                  key={`extra-${i}`}
                  className="text-red-400 text-[12px] mb-1"
                >
                  Interrupted
                </div>
              );
            }
            return null;
          })}

          {/* Extra streaming */}
          {isExtraStreaming && (
            <div className="text-ink/70 whitespace-pre-wrap mt-1">
              {extraStreaming}
              <Cursor />
            </div>
          )}
        </div>

        {/* Prompt box */}
        <div className="border-t border-ink/[0.1] text-[12.5px]">
          {!promptSubmitted ? (
            <div className="min-h-[24px] px-5 py-3 text-ink/70 leading-[1.65]">
              {promptText}
              <Cursor />
            </div>
          ) : (
            <form onSubmit={handleUserSubmit}>
              <input
                ref={inputRef}
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Ask a question…"
                className="w-full px-5 py-3 min-h-[24px] bg-transparent text-ink/70 placeholder:text-ink/20 outline-none leading-[1.65]"
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
