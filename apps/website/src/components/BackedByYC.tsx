import { YCLogo } from "../icons";
import { YC_URL } from "../site";

export function BackedByYC({
  className = "",
  fathomEvent,
}: {
  className?: string;
  fathomEvent: string;
}) {
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
    </a>
  );
}
