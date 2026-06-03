import classnames from "classnames";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "../icons/index.js";

interface ShellCommandProps {
  ariaLabel: string;
  className?: string;
  command: string;
  fathomEvent: string;
}

function CopyButton({
  ariaLabel,
  className,
  copied,
  fathomEvent,
  onCopy,
}: {
  ariaLabel: string;
  className: string;
  copied: boolean;
  fathomEvent: string;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={ariaLabel}
      className={`copy-icon-btn absolute flex size-7 items-center justify-center rounded-lg ${className}`}
      data-fathom-event={fathomEvent}
    >
      <div className="relative size-[18px] shrink-0">
        <div
          className={classnames(
            "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out",
            copied ? "scale-100 opacity-100" : "scale-[0.25] opacity-0",
          )}
        >
          <CheckIcon width={18} height={18} />
        </div>
        <div
          className={classnames(
            "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out",
            copied ? "scale-[0.25] opacity-0" : "scale-100 opacity-100",
          )}
        >
          <CopyIcon width={18} height={18} />
        </div>
      </div>
    </button>
  );
}

export function ShellCommand({
  ariaLabel,
  className = "",
  command,
  fathomEvent,
}: ShellCommandProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={`relative rounded-lg border border-ink/10 bg-panel-hi px-4 py-3 pr-11 font-mono text-[13px] text-ink shadow-sm ${className}`.trim()}
    >
      <CopyButton
        ariaLabel={ariaLabel}
        className="right-2.5 top-1/2 -translate-y-1/2"
        copied={copied}
        fathomEvent={fathomEvent}
        onCopy={handleCopy}
      />
      <div className="flex items-center">
        <span className="w-4 select-none text-ink/20">$</span>
        <span className="pl-2">{command}</span>
      </div>
    </div>
  );
}
