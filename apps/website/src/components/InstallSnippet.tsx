import classnames from "classnames";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "../icons";

const COMMAND = "npm init libretto@latest";

export function InstallSnippet() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex justify-center mb-6">
      <div className="relative rounded-xl shadow-sm bg-white font-mono text-[13px] text-ink/80 px-5 py-4 pr-12">
        <button
          type="button"
          onClick={handleCopy}
          className="copy-icon-btn absolute top-2.5 right-2.5 size-7 flex items-center justify-center rounded-lg"
        >
          <div className="relative">
            <div
              className={classnames(
                "absolute inset-0 flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out will-change-[opacity,filter,scale]",
                copied ? "scale-100 opacity-100" : "scale-[0.25] opacity-0",
              )}
            >
              <CheckIcon width={18} height={18} />
            </div>
            <div
              className={classnames(
                "flex items-center justify-center text-ink/50 transition-[opacity,filter,scale] duration-240 ease-in-out will-change-[opacity,filter,scale]",
                copied ? "scale-[0.25] opacity-0" : "scale-100 opacity-100",
              )}
            >
              <CopyIcon width={18} height={18} />
            </div>
          </div>
        </button>
        <div className="flex items-center">
          <span className="select-none text-ink/20 w-4">$</span>
          <span className="pl-2">{COMMAND}</span>
        </div>
      </div>
    </div>
  );
}
