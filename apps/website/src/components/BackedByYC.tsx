import { YCLogo } from "../icons";
import { YC_URL } from "../site";

function ExternalArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M6 4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h6A1.5 1.5 0 0 0 12 11.5V10" />
      <path d="M9 3h4v4" />
      <path d="m8 8 5-5" />
    </svg>
  );
}

/** `badge` is the prominent hero lockup; `credit` is the compact footer mark. */
export function BackedByYC({
  className = "",
  fathomEvent,
  variant = "credit",
}: {
  className?: string;
  fathomEvent: string;
  variant?: "badge" | "credit";
}) {
  if (variant === "badge") {
    return (
      <a
        href={YC_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 font-mono text-xs text-muted/60 no-underline transition-colors hover:text-muted sm:text-[13px] ${className}`}
        data-fathom-event={fathomEvent}
      >
        <YCLogo className="size-4 shrink-0 sm:size-[18px]" width={18} height={18} />
        <span className="leading-none">
          Backed by Y Combinator
        </span>
      </a>
    );
  }

  return (
    <a
      href={YC_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 no-underline transition-colors ${className}`}
      data-fathom-event={fathomEvent}
    >
      <YCLogo className="size-3.5 shrink-0" />
      Backed by YC
      <ExternalArrowIcon className="size-3 shrink-0 opacity-70" />
    </a>
  );
}
