import { YCLogo } from "../icons";

export function BackedByYC({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-xs text-muted/60 sm:text-[13px] ${className}`}
    >
      <YCLogo className="size-4 shrink-0 sm:size-[18px]" width={18} height={18} />
      <span className="leading-none">Backed by Y Combinator</span>
    </span>
  );
}
