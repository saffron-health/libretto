import { useState } from "react";
import { Button } from "./Button";

const PROMPT =
  "Fetch and follow https://libretto.sh/start.md to set up Libretto and create a new browser automation.";
const PROMPT_SNIPPET = "Fetch and follow https://libretto.sh/start.md";

export function InstallSnippet() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="install-prompt inline-flex max-w-full items-stretch overflow-hidden rounded-lg">
      <span className="install-prompt__snippet" aria-hidden="true">
        <span className="truncate">{PROMPT_SNIPPET}</span>
        <span className="shrink-0 text-faint">...</span>
      </span>
      <Button
        onClick={handleCopy}
        aria-label="Copy Libretto setup prompt"
        className="install-prompt__button"
      >
        {copied ? "Copied" : "Copy prompt"}
      </Button>
    </div>
  );
}
