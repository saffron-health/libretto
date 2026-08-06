import { useState } from "react";
import { Button } from "./Button";

const PROMPT =
  "Fetch and follow https://libretto.sh/start.md to set up Libretto and create a new browser automation.";

export function InstallSnippet({
  fathomEvent = "Hero copy prompt click",
  onCopy,
  preview,
  prompt = PROMPT,
}: {
  fathomEvent?: string;
  onCopy?: () => void;
  /** Short label shown in the snippet; the full `prompt` is still copied. */
  preview?: string;
  prompt?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="install-prompt inline-flex max-w-full items-stretch overflow-hidden">
      <span className="install-prompt__snippet" aria-hidden="true">
        <span className="install-prompt__snippet-text">
          {preview ?? prompt}
        </span>
      </span>
      <Button
        onClick={handleCopy}
        aria-label="Copy Libretto setup prompt"
        className="install-prompt__button"
        data-fathom-event={fathomEvent}
      >
        {copied ? "Copied" : "Copy prompt"}
      </Button>
    </div>
  );
}
