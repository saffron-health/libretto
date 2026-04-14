import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;
const STEP_SPIN_DURATION_MS = 1800;
const STEP_PAUSE_AFTER_CHECK_MS = 400;
const SUCCESS_HOLD_MS = 3000;
const RESET_PAUSE_MS = 600;

const TEAL = "oklch(0.55 0.15 175)";
const GREEN = "oklch(0.55 0.16 155)";

const STEPS = [
  "Grepping network requests",
  "Inspecting cookies",
  "Looking at request headers",
  "Determining best automation approach",
] as const;

// ── Braille Spinner ──────────────────────────────────────────────────────────

function useBrailleFrame(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);
  return BRAILLE_FRAMES[frame]!;
}

function BrailleSpinner() {
  const char = useBrailleFrame();
  return <span style={{ color: TEAL }}>{char}</span>;
}

// ── Step Icon (spinner → checkmark crossfade) ────────────────────────────────

const crossfade = { duration: 0.15, ease: "easeOut" as const };

function StepIcon({ done }: { done: boolean }) {
  return (
    <span className="inline-flex w-4 items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="check"
            className="flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={crossfade}
            style={{ color: GREEN }}
          >
            ✓
          </motion.span>
        ) : (
          <motion.span
            key="spinner"
            className="flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={crossfade}
          >
            <BrailleSpinner />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ── Step Row ─────────────────────────────────────────────────────────────────

function StepRow({
  label,
  done,
  textColor,
}: {
  label: string;
  done: boolean;
  textColor?: string;
}) {
  return (
    <motion.div
      layout
      className="flex items-center gap-2 font-sans text-xs"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <StepIcon done={done} />
      <span
        style={{
          color: textColor ?? (done ? "var(--color-muted)" : "var(--color-faint)"),
          transition: "color 0.3s ease",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

// ── Mock Website Panel ────────────────────────────────────────────────────────

function MockWebsitePanel() {
  return (
    <div
      className="relative min-w-[76%] flex-1 overflow-visible rounded-lg border border-ink/10 bg-white/60 sm:min-w-0"
      style={{ alignSelf: "safe center" }}
    >
      {/* Placeholder layout lines */}
      <div className="flex flex-col gap-2 p-4 pt-5">
        {/* Nav bar suggestion */}
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-ink/10" />
          <div className="h-1.5 w-16 rounded bg-ink/10" />
          <div className="ml-auto flex gap-1.5">
            <div className="h-1.5 w-8 rounded bg-ink/8" />
            <div className="h-1.5 w-8 rounded bg-ink/8" />
            <div className="h-1.5 w-8 rounded bg-ink/8" />
          </div>
        </div>
        {/* Hero block */}
        <div className="h-2 w-3/4 rounded bg-ink/10" />
        <div className="h-2 w-1/2 rounded bg-ink/8" />
        <div className="mt-1 h-1.5 w-full rounded bg-ink/6" />
        <div className="h-1.5 w-5/6 rounded bg-ink/6" />
        <div className="h-1.5 w-4/6 rounded bg-ink/6" />
        {/* Button suggestion */}
        <div className="mt-2 h-4 w-16 rounded bg-ink/10" />
        {/* Card row */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1 rounded bg-ink/4 p-1.5">
              <div className="h-1.5 w-full rounded bg-ink/8" />
              <div className="h-1.5 w-4/5 rounded bg-ink/6" />
            </div>
          ))}
        </div>
        <div className="mt-2 h-1.5 w-full rounded bg-ink/6" />
        <div className="h-1.5 w-3/4 rounded bg-ink/6" />
      </div>

      {/* Scan line */}
      <motion.div
        className="pointer-events-none absolute h-0.5"
        style={{
          left: "-20%",
          right: "-20%",
          background: `linear-gradient(to right, transparent, ${TEAL}, transparent)`,
          boxShadow: `0 0 10px 3px ${TEAL}55`,
        }}
        initial={{ top: "10%" }}
        animate={{ top: "88%" }}
        transition={{
          duration: 3.5,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "reverse",
        }}
      />

      {/* Subtle teal overlay tint following scan line — adds glow feel */}
      <motion.div
        className="pointer-events-none absolute h-12 -translate-y-1/2"
        style={{
          left: "-20%",
          right: "-20%",
          background: `linear-gradient(to bottom, transparent, ${TEAL}0a, transparent)`,
        }}
        initial={{ top: "10%" }}
        animate={{ top: "88%" }}
        transition={{
          duration: 3.5,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "reverse",
        }}
      />
    </div>
  );
}

// ── State machine types ───────────────────────────────────────────────────────

interface ScanState {
  /** How many step rows are visible (0-based count) */
  visibleCount: number;
  /** Which step indices are "done" (spinner → check) */
  doneIndices: Set<number>;
  /** Whether the success line is visible */
  showSuccess: boolean;
}

const INITIAL_STATE: ScanState = {
  visibleCount: 0,
  doneIndices: new Set(),
  showSuccess: false,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SecurityScanAnimation() {
  const [state, setState] = useState<ScanState>(INITIAL_STATE);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function run() {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelledRef.current) return;

        // Reset
        setState(INITIAL_STATE);
        await sleep(RESET_PAUSE_MS);
        if (cancelledRef.current) return;

        for (let i = 0; i < STEPS.length; i++) {
          // Show step i (spinner)
          setState((prev) => ({ ...prev, visibleCount: i + 1 }));
          await sleep(STEP_SPIN_DURATION_MS);
          if (cancelledRef.current) return;

          // Mark step i done (checkmark)
          setState((prev) => ({
            ...prev,
            doneIndices: new Set([...prev.doneIndices, i]),
          }));
          await sleep(STEP_PAUSE_AFTER_CHECK_MS);
          if (cancelledRef.current) return;
        }

        // Show success line
        setState((prev) => ({ ...prev, showSuccess: true }));
        await sleep(SUCCESS_HOLD_MS);
        if (cancelledRef.current) return;

        // Fade out everything
        setState((prev) => ({
          ...prev,
          visibleCount: 0,
          doneIndices: new Set(),
          showSuccess: false,
        }));
        await sleep(RESET_PAUSE_MS);
        if (cancelledRef.current) return;
      }
    }

    void run();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-row items-start gap-3 overflow-visible p-4 sm:items-center">
      {/* Left: checklist */}
      <motion.div
        layout
        className="flex h-full w-[44%] shrink-0 self-stretch flex-col-reverse justify-center gap-2 sm:w-2/5"
      >
        <AnimatePresence>
          {state.showSuccess && (
            <StepRow
              key="success"
              label="Safe to automate"
              done
              textColor={GREEN}
            />
          )}

          {[...STEPS.slice(0, state.visibleCount)].reverse().map((label) => {
            const index = STEPS.indexOf(label);
            return (
              <StepRow
                key={label}
                label={label}
                done={state.doneIndices.has(index)}
              />
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* Right: mock website with scan line */}
      <MockWebsitePanel />
    </div>
  );
}
