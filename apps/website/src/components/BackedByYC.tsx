import { YCLogo } from "../icons";

export function BackedByYC({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[13px] text-muted/60 sm:text-sm ${className}`}
    >
      <YCLogo className="size-[18px] shrink-0 sm:size-5" width={20} height={20} />
      <span className="leading-none">Backed by Y Combinator</span>
    </span>
  );
}
