import type { ComponentPropsWithoutRef } from "react";

export const LIBRETTO_NAME = "Libretto";
export const LIBRETTO_LOGO_DARK_SRC = "/logos/logo-dark.svg";
export const LIBRETTO_LOGO_LIGHT_SRC = "/logos/logo-light.svg";
export const ASCII_LIBRETTO_WORDMARK_SRC =
  "/brand-kit/wordmark/libretto-ascii-wordmark.svg";

export const BROWSER_AGENTS_SCRIPT_JOB_TEXT =
  "DON'T MAKE BROWSER AGENTS DO A SCRIPT'S JOB";

export const LIBRETTO_ASCII_NAME = String.raw` ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

export const LIBRETTO_ASCII_NAME_COLS = Math.max(
  ...LIBRETTO_ASCII_NAME.split("\n").map((line) => line.length),
);

export const BROWSER_AGENTS_SCRIPT_JOB_ASCII = String.raw`██████╗  ██████╗ ███╗   ██╗██╗████████╗  ███╗   ███╗ █████╗ ██╗  ██╗███████╗
██╔══██╗██╔═══██╗████╗  ██║╚═╝╚══██╔══╝  ████╗ ████║██╔══██╗██║ ██╔╝██╔════╝
██║  ██║██║   ██║██╔██╗ ██║      ██║     ██╔████╔██║███████║█████╔╝ █████╗
██║  ██║██║   ██║██║╚██╗██║      ██║     ██║╚██╔╝██║██╔══██║██╔═██╗ ██╔══╝
██████╔╝╚██████╔╝██║ ╚████║      ██║     ██║ ╚═╝ ██║██║  ██║██║  ██╗███████╗
╚═════╝  ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝

██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗    █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗
██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝
██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗
██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║
╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝

██████╗  ██████╗    █████╗    ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗██╗███████╗
██╔══██╗██╔═══██╗  ██╔══██╗   ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝╚═╝██╔════╝
██║  ██║██║   ██║  ███████║   ███████╗██║     ██████╔╝██║██████╔╝   ██║      ███████╗
██║  ██║██║   ██║  ██╔══██║   ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║      ╚════██║
██████╔╝╚██████╔╝  ██║  ██║   ███████║╚██████╗██║  ██║██║██║        ██║      ███████║
╚═════╝  ╚═════╝   ╚═╝  ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝      ╚══════╝

     ██╗ ██████╗ ██████╗
     ██║██╔═══██╗██╔══██╗
     ██║██║   ██║██████╔╝
██   ██║██║   ██║██╔══██╗
╚█████╔╝╚██████╔╝██████╔╝
 ╚════╝  ╚═════╝ ╚═════╝`;

export const BROWSER_AGENTS_SCRIPT_JOB_COMPACT_ASCII = createCompactAscii(
  BROWSER_AGENTS_SCRIPT_JOB_TEXT,
);

type ImageProps = Omit<ComponentPropsWithoutRef<"img">, "src">;
type LogoAndNameProps = ComponentPropsWithoutRef<"span"> & {
  variant?: "dark" | "light";
};
type TextMarkProps = ComponentPropsWithoutRef<"span">;

export function LibrettoLogoMark({
  alt = "",
  variant = "dark",
  ...props
}: ImageProps & { variant?: "dark" | "light" }) {
  return (
    <img
      {...props}
      src={variant === "dark" ? LIBRETTO_LOGO_DARK_SRC : LIBRETTO_LOGO_LIGHT_SRC}
      alt={alt}
    />
  );
}

export function LibrettoWordmark({
  className = "",
  ...props
}: TextMarkProps) {
  return (
    <span
      {...props}
      className={`font-serif font-[300] leading-none tracking-[0] text-ink ${className}`.trim()}
    >
      {LIBRETTO_NAME}
    </span>
  );
}

export function LibrettoLogoAndName({
  className = "",
  variant = "dark",
  ...props
}: LogoAndNameProps) {
  return (
    <span {...props} className={`flex items-center gap-1 ${className}`.trim()}>
      <LibrettoLogoMark variant={variant} className="size-6 shrink-0" />
      <LibrettoWordmark className="shrink-0 text-[1.35rem]" />
    </span>
  );
}

export function AsciiLibretto({
  className = "",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <pre
      aria-hidden={decorative}
      aria-label={decorative ? undefined : LIBRETTO_NAME}
      className={`whitespace-pre leading-none tracking-[0] font-mono text-amber ${className}`}
      style={{
        textShadow:
          "0 0 8px color-mix(in oklch, var(--color-amber-bright) 50%, transparent), 0 0 24px color-mix(in oklch, var(--color-amber-bright) 25%, transparent)",
      }}
    >
      {LIBRETTO_ASCII_NAME}
    </pre>
  );
}

export function BrowserAgentsScriptJobAscii({
  className = "",
}: {
  className?: string;
}) {
  return (
    <pre
      aria-label={BROWSER_AGENTS_SCRIPT_JOB_TEXT}
      className={`whitespace-pre font-mono font-semibold leading-none tracking-[0] text-amber ${className}`}
      style={{
        textShadow:
          "0 0 8px color-mix(in oklch, var(--color-amber-bright) 50%, transparent), 0 0 24px color-mix(in oklch, var(--color-amber-bright) 25%, transparent)",
      }}
    >
      {BROWSER_AGENTS_SCRIPT_JOB_ASCII}
    </pre>
  );
}

function createCompactAscii(value: string) {
  const glyphs: Record<string, string[]> = {
    A: [" ██ ", "█  █", "████", "█  █", "█  █"],
    B: ["███ ", "█  █", "███ ", "█  █", "███ "],
    C: [" ███", "█   ", "█   ", "█   ", " ███"],
    D: ["███ ", "█  █", "█  █", "█  █", "███ "],
    E: ["████", "█   ", "███ ", "█   ", "████"],
    G: [" ███", "█   ", "█ ██", "█  █", " ███"],
    I: ["███", " █ ", " █ ", " █ ", "███"],
    J: ["  ██", "   █", "   █", "█  █", " ██ "],
    K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
    M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    N: ["█  █", "██ █", "█ ██", "█  █", "█  █"],
    O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
    P: ["███ ", "█  █", "███ ", "█   ", "█   "],
    R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
    S: [" ███", "█   ", " ██ ", "   █", "███ "],
    T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
    "'": ["█", "█", " ", " ", " "],
    " ": ["   ", "   ", "   ", "   ", "   "],
  };

  return Array.from({ length: 5 }, (_, rowIndex) =>
    Array.from(value.toUpperCase())
      .map((character) => glyphs[character]?.[rowIndex] ?? character)
      .join(" ")
      .trimEnd(),
  ).join("\n");
}
