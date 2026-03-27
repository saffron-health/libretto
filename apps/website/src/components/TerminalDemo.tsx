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
          <div className="flex items-center gap-1.5">
            <svg className="size-3.5" viewBox="0 0 26 28" fill="none">
              <path
                d="M5.07306 17.7192L9.99106 14.9614L10.0721 14.7199L9.99106 14.5854H9.74786L8.92369 14.5352L6.11341 14.46L3.68143 14.3597L1.31701 14.2344L0.722529 14.109L0.168579 13.3694L0.222623 13.0059L0.722529 12.6675L1.43861 12.7301L3.0194 12.8429L5.39733 13.0059L7.11322 13.1062L9.66679 13.3694H10.0721L10.1262 13.2065L9.99106 13.1062L9.88297 13.0059L7.42397 11.3387L4.76231 9.58378L3.37068 8.56843L2.62758 8.05448L2.24927 7.57814L2.08714 6.52518L2.76269 5.77306L3.68143 5.83574L3.91112 5.89842L4.84338 6.61293L6.82949 8.15476L9.4236 10.0601L9.80191 10.3735L9.95424 10.2707L9.97755 10.198L9.80191 9.9097L8.39676 7.36504L6.89705 4.77024L6.2215 3.69221L6.04585 3.05291C5.97781 2.78463 5.93777 2.56267 5.93777 2.28826L6.70789 1.2353L7.14024 1.09741L8.18059 1.2353L8.61294 1.61136L9.26147 3.09052L10.3018 5.40954L11.9231 8.56843L12.396 9.50857L12.6527 10.3735L12.7473 10.6367H12.9094V10.4863L13.0445 8.70631L13.2877 6.52518L13.5309 3.71728L13.612 2.92756L14.0038 1.97488L14.7875 1.46093L15.3954 1.74925L15.8954 2.46376L15.8278 2.92756L15.5306 4.85799L14.9496 7.87899L14.5713 9.9097H14.7875L15.0442 9.64646L16.071 8.29265L17.7869 6.13659L18.5435 5.28419L19.4352 4.34404L20.0027 3.89277H21.0836L21.8672 5.07109L21.5159 6.28701L20.408 7.69096L19.4893 8.88181L18.172 10.6467L17.3545 12.0658L17.4278 12.1828L17.6248 12.166L20.5972 11.5267L22.205 11.2384L24.1235 10.9125L24.9882 11.3136L25.0828 11.7273L24.745 12.5672L22.6914 13.0686L20.2864 13.5575L16.7051 14.4005L16.6655 14.4324L16.7123 14.5018L18.3273 14.648L19.0164 14.6856H20.7053L23.8533 14.9238L24.6775 15.4628L25.1639 16.1272L25.0828 16.6411L23.8128 17.2804L22.1104 16.8793L18.1247 15.9266L16.7601 15.5882H16.5709V15.701L17.7058 16.8166L19.8 18.6969L22.4076 21.1288L22.5428 21.7304L22.205 22.2068L21.8537 22.1566L19.5568 20.4268L18.6651 19.6496L16.6655 17.9573H16.5304V18.1328L16.9897 18.8097L19.4352 22.4826L19.5568 23.6107L19.3812 23.9743L18.7462 24.1999L18.0571 24.0745L16.6114 22.0564L15.1387 19.8L13.9498 17.7693L13.8062 17.86L13.0986 25.4158L12.7743 25.8044L12.0177 26.0927L11.3827 25.6164L11.0449 24.8392L11.3827 23.2974L11.788 21.2917L12.1123 19.6997L12.4095 17.7192L12.5911 17.0575L12.575 17.0133L12.43 17.0376L10.9368 19.0855L8.66698 22.1566L6.87002 24.0745L6.43767 24.25L5.69457 23.8614L5.76212 23.172L6.18096 22.5578L8.66698 19.3989L10.1667 17.4309L11.1333 16.3012L11.1239 16.1378L11.0705 16.1332L4.46507 20.4393L3.28961 20.5897L2.7762 20.1134L2.84375 19.3362L3.08695 19.0855L5.07306 17.7192Z"
                fill="#D97757"
              />
            </svg>
            <span className="text-xs font-medium text-ink/40">Claude Code</span>
          </div>
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
