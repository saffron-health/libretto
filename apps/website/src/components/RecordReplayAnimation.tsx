"use client";

import { AnimatePresence, motion } from "motion/react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type Phase = "recording" | "thinking" | "replaying" | "done";

const ACCENT = "oklch(0.82 0.20 145)"; // phosphor green agent cursor

// Resting positions (outside the panel)
const DEV_HOME = { x: 88, y: 35 }; // right side
const AGENT_HOME = { x: 5, y: 35 }; // left side
const PANEL_WIDTH_CLASS = "w-[72%] sm:w-[60%] md:w-[55%]";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function RecordDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400/70 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-red-400" />
    </span>
  );
}

function BrainIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 2a4 4 0 0 0-4 4c0 .55.11 1.07.3 1.55A4 4 0 0 0 4 11a4 4 0 0 0 2 3.46V17a3 3 0 0 0 6 0v-.09A4 4 0 0 0 14.5 13a4 4 0 0 0-1-2.65A4 4 0 0 0 14 6a4 4 0 0 0-4.5-3.96z" />
      <path d="M14.5 2a4 4 0 0 1 4 4c0 .55-.11 1.07-.3 1.55A4 4 0 0 1 20 11a4 4 0 0 1-2 3.46V17a3 3 0 0 1-6 0v-.09A4 4 0 0 1 9.5 13" />
    </svg>
  );
}

function ChevronsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.75 4.75L13.25 12L5.75 19.25" />
      <path d="M11.75 4.75L19.25 12L11.75 19.25" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.75 12.75L9.25 17.25L19.25 7.75" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Cursor SVG component
// ---------------------------------------------------------------------------

interface CursorProps {
  color: string;
  label: string;
  labelClassName: string;
  labelSide?: "left" | "right";
}

function CursorShape({
  color,
  label,
  labelClassName,
  labelSide = "right",
}: CursorProps) {
  return (
    <div className="relative h-4 w-4">
      <svg
        className="absolute top-0 left-0"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: `drop-shadow(0 1px 3px ${color}55)`,
          transform: "rotate(15deg)",
        }}
      >
        <path
          d="M22 10.2069L3 3L10.2069 22L13.4828 13.4828L22 10.2069Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`absolute top-full mt-0.5 whitespace-nowrap px-1.5 py-0.5 text-[9px] font-medium leading-none text-white ${labelSide === "left" ? "right-0 mr-2" : "left-0 ml-2"} ${labelClassName}`}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Click ring
// ---------------------------------------------------------------------------

interface ClickRingProps {
  color: string;
  visible: boolean;
}

function ClickRing({ color, visible }: ClickRingProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ borderColor: color, width: 24, height: 24 }}
          initial={{ scale: 0.3, opacity: 0.9 }}
          animate={{ scale: 2, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Status bar label cross-fade
// ---------------------------------------------------------------------------

interface StatusLabelProps {
  phase: Phase;
}

function StatusBadge({ phase }: StatusLabelProps) {
  const label =
    phase === "recording"
      ? "Recording"
      : phase === "thinking"
        ? "Thinking"
        : phase === "replaying"
          ? "Replaying"
          : "Done";

  const colorClass =
    phase === "recording"
      ? "text-red-400"
      : phase === "thinking"
        ? "text-amber-500"
        : phase === "replaying"
          ? "text-accent"
          : "text-green-600";

  const icon =
    phase === "recording" ? (
      <RecordDot />
    ) : phase === "thinking" ? (
      <span className="text-amber-500">
        <BrainIcon />
      </span>
    ) : phase === "replaying" ? (
      <span className="text-accent">
        <ChevronsIcon />
      </span>
    ) : (
      <span className="text-green-600">
        <CheckIcon />
      </span>
    );

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={label}
        className={`flex items-center gap-1.5 text-xs font-medium ${colorClass}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {icon}
        {label}
      </motion.span>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Patient detail pane (fake modal overlay inside the panel)
// ---------------------------------------------------------------------------

function PatientDetailPane() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
      <div className="flex h-[76%] w-[76%] flex-col overflow-hidden border border-accent/20 bg-bg p-3 sm:h-[80%] sm:w-[80%]">
        {/* Header */}
        <div className="mb-3 flex items-center gap-2 border-b border-accent/15 pb-2">
          <div className="size-8 shrink-0 bg-accent/8" />
          <div className="flex flex-col gap-0.5">
            <div className="h-2.5 w-24 bg-accent/10" />
            <div className="h-1.5 w-16 bg-accent/6" />
          </div>
        </div>

        {/* Detail rows */}
        <div className="space-y-2.5">
          {[
            { label: "DOB", width: "w-20" },
            { label: "Phone", width: "w-24" },
            { label: "Insurance", width: "w-28" },
            { label: "Provider", width: "w-20" },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-14 text-[9px] font-medium text-accent/30">
                {row.label}
              </span>
              <div className={`h-2 ${row.width} bg-accent/10`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RecordReplayAnimation() {
  const [phase, setPhase] = useState<Phase>("recording");

  // Cursor positions as percentages of the FULL container (not just the panel)
  const [devPos, setDevPos] = useState(DEV_HOME);
  const [agentPos, setAgentPos] = useState(AGENT_HOME);
  const [activeCursor, setActiveCursor] = useState<"dev" | "agent" | "none">(
    "dev",
  );

  const [searchText, setSearchText] = useState("");
  const searchTextRef = useRef("");

  const [showResults, setShowResults] = useState(false);
  const [showPatientDetail, setShowPatientDetail] = useState(false);

  // Click rings
  const [devClick, setDevClick] = useState(false);
  const [agentClick, setAgentClick] = useState(false);

  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  // Refs for measuring element positions
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const firstResultRef = useRef<HTMLDivElement>(null);

  // Callback ref for the first result row (assigned during render)
  const setFirstResultRef = useCallback((el: HTMLDivElement | null) => {
    firstResultRef.current = el;
  }, []);

  /** Return { x, y } as percentages of the container, targeting the center of the element */
  function getRelativePos(elRef: RefObject<HTMLElement | null>): {
    x: number;
    y: number;
  } {
    const container = containerRef.current;
    const el = elRef.current;
    if (!container || !el) {
      // Fallback to center if refs aren't mounted yet
      return { x: 50, y: 50 };
    }
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const x = ((eRect.left + eRect.width / 2 - cRect.left) / cRect.width) * 100;
    const y = ((eRect.top + eRect.height / 2 - cRect.top) / cRect.height) * 100;
    return { x, y };
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function moveDev(x: number, y: number, dur = 400) {
    setDevPos({ x, y });
    await sleep(dur);
  }

  async function moveAgent(x: number, y: number, dur = 200) {
    setAgentPos({ x, y });
    await sleep(dur);
  }

  async function clickDev() {
    setDevClick(true);
    await sleep(50);
    setDevClick(false);
    await sleep(300);
  }

  async function clickAgent() {
    setAgentClick(true);
    await sleep(50);
    setAgentClick(false);
    await sleep(150);
  }

  async function typeText(text: string, perChar = 120, id?: number) {
    for (const ch of text) {
      if (cancelRef.current || (id !== undefined && id !== runIdRef.current))
        return;
      searchTextRef.current += ch;
      setSearchText(searchTextRef.current);
      await sleep(perChar);
    }
  }

  function fillText(text: string) {
    searchTextRef.current = text;
    setSearchText(text);
  }

  function resetSearchText() {
    searchTextRef.current = "";
    setSearchText("");
  }

  function backspaceSearchText() {
    searchTextRef.current = searchTextRef.current.slice(0, -1);
    setSearchText(searchTextRef.current);
  }

  function appendSearchChar(ch: string) {
    searchTextRef.current += ch;
    setSearchText(searchTextRef.current);
  }

  async function runSequence(id: number) {
    // If a newer run has started, bail out immediately
    if (id !== runIdRef.current) return;

    // -----------------------------------------------------------------------
    // RESET
    // -----------------------------------------------------------------------
    setPhase("recording");
    resetSearchText();
    setShowResults(false);
    setShowPatientDetail(false);
    setActiveCursor("dev");
    setDevPos(DEV_HOME);
    setAgentPos(AGENT_HOME);
    await sleep(600);

    // -----------------------------------------------------------------------
    // PHASE 1 — Recording
    // -----------------------------------------------------------------------

    // Move dev cursor to the search input
    const inputPos = getRelativePos(searchInputRef);
    await moveDev(inputPos.x, inputPos.y, 500);
    await clickDev();

    // Type "John Dor"
    await typeText("John Dor", 120, id);
    await sleep(200);
    // Backspace 'r'
    backspaceSearchText();
    await sleep(150);
    // Type 'e'
    appendSearchChar("e");
    await sleep(300);

    // Move to search button
    const btnPos = getRelativePos(searchButtonRef);
    await moveDev(btnPos.x, btnPos.y, 400);
    await clickDev();

    // Results appear
    setShowResults(true);
    // Wait for results to render and measure
    await sleep(600);

    // Click first result → open patient detail
    const resultPos = getRelativePos(firstResultRef);
    await moveDev(resultPos.x, resultPos.y, 400);
    await clickDev();
    setShowPatientDetail(true);
    await sleep(800);

    // Move dev cursor back to resting position (right side)
    await moveDev(DEV_HOME.x, DEV_HOME.y, 500);

    // -----------------------------------------------------------------------
    // PHASE 2 — Thinking
    // -----------------------------------------------------------------------
    setPhase("thinking");
    setShowPatientDetail(false);
    await sleep(1500);

    // -----------------------------------------------------------------------
    // PHASE 3 — Replaying
    // -----------------------------------------------------------------------
    setPhase("replaying");

    // Reset mock UI
    resetSearchText();
    setShowResults(false);
    setShowPatientDetail(false);

    // Switch cursors
    setActiveCursor("agent");
    setAgentPos(AGENT_HOME);
    await sleep(400);

    // Agent moves to the search input
    const inputPos2 = getRelativePos(searchInputRef);
    await moveAgent(inputPos2.x, inputPos2.y, 250);
    await clickAgent();

    // Agent fills the input instantly
    fillText("John Doe");
    await sleep(150);

    // Click search button
    const btnPos2 = getRelativePos(searchButtonRef);
    await moveAgent(btnPos2.x, btnPos2.y, 200);
    await clickAgent();

    setShowResults(true);
    await sleep(400);

    // Click first result → open patient detail
    const resultPos2 = getRelativePos(firstResultRef);
    await moveAgent(resultPos2.x, resultPos2.y, 200);
    await clickAgent();
    setShowPatientDetail(true);
    await sleep(500);

    // Move agent cursor back to resting position (left side)
    await moveAgent(AGENT_HOME.x, AGENT_HOME.y, 400);
    setActiveCursor("none");

    // -----------------------------------------------------------------------
    // PHASE 4 — Done
    // -----------------------------------------------------------------------
    setPhase("done");
    await sleep(10000);

    // Loop
    if (!cancelRef.current && id === runIdRef.current) {
      void runSequence(id);
    }
  }

  useEffect(() => {
    cancelRef.current = false;
    const id = ++runIdRef.current;
    void runSequence(id);
    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden font-sans"
    >
      {/* Main area — relative container holding the panel + cursors */}
      <div className="flex h-full flex-col items-center justify-center">
        {/* Status bar — same width as panel, no background */}
        <div className={`flex ${PANEL_WIDTH_CLASS} items-center px-1 pb-3`}>
          <StatusBadge phase={phase} />
        </div>

        {/* Mock website panel — centered, wider on mobile, constrained height */}
        <div
          className={`relative ${PANEL_WIDTH_CLASS} mb-6 max-h-[72%] overflow-hidden border border-accent/25 p-3 sm:max-h-[70%]`}
        >
          {/* Search bar row */}
          <div className="flex gap-2">
            <div
              ref={searchInputRef}
              className="flex flex-1 items-center border border-accent/20 px-2 py-1.5 text-xs text-accent/40"
            >
              <span className="mr-2 shrink-0 text-accent/25">▸</span>
              <span className="min-w-0 flex-1 truncate">
                {searchText || (
                  <span className="text-accent/20">Search patients</span>
                )}
                {searchText && (
                  <span className="inline-block w-px bg-accent/60">
                    &nbsp;
                  </span>
                )}
              </span>
            </div>
            <button
              ref={searchButtonRef}
              className="border border-accent/30 bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent/70"
            >
              Search
            </button>
          </div>

          {/* Results — invisible placeholders always reserve space so the panel
               doesn't resize; animated rows render on top via AnimatePresence */}
          <div className="relative mt-3">
            {/* Invisible spacer rows — always mounted to hold height */}
            <div
              className="pointer-events-none invisible space-y-2"
              aria-hidden
            >
              {[80, 65, 72].map((width, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border border-transparent px-3 py-2.5"
                >
                  <div className="size-6 shrink-0" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div
                      className="h-2"
                      style={{ width: `${width}%` }}
                    />
                    <div
                      className="h-1.5"
                      style={{ width: `${width * 0.6}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Visible rows — absolutely positioned over the spacers */}
            <div className="absolute inset-0 space-y-2">
              {showResults &&
                [80, 65, 72].map((width, i) => (
                  <div
                    key={i}
                    ref={i === 0 ? setFirstResultRef : undefined}
                    className="flex cursor-pointer items-center gap-3 border border-accent/15 px-3 py-2.5"
                  >
                    <div className="size-6 shrink-0 bg-accent/8" />
                    <div className="flex flex-1 flex-col gap-1">
                      <div
                        className="h-2 bg-accent/10"
                        style={{ width: `${width}%` }}
                      />
                      <div
                        className="h-1.5 bg-accent/6"
                        style={{ width: `${width * 0.6}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Patient detail overlay — shown after clicking a result */}
          {showPatientDetail && <PatientDetailPane />}
        </div>
      </div>

      {/* Dev cursor (red) — always rendered, opacity reflects active state */}
      <motion.div
        className="pointer-events-none absolute z-10"
        animate={{
          left: `${devPos.x}%`,
          top: `${devPos.y}%`,
          opacity: activeCursor === "dev" ? 1 : 0.3,
        }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <ClickRing color="#ef4444" visible={devClick} />
        <CursorShape color="#ef4444" label="You" labelClassName="bg-red-500" />
      </motion.div>

      {/* Agent cursor (teal) — always rendered, opacity reflects active state */}
      <motion.div
        className="pointer-events-none absolute z-10"
        animate={{
          left: `${agentPos.x}%`,
          top: `${agentPos.y}%`,
          opacity: activeCursor === "agent" ? 1 : 0.3,
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <ClickRing color={ACCENT} visible={agentClick} />
        <CursorShape
          color={ACCENT}
          label="Agent"
          labelClassName="bg-accent"
        />
      </motion.div>
    </div>
  );
}
