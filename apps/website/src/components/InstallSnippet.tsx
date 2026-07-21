import { useState } from "react";
import { Button } from "./Button";

const PROMPT =
  "Fetch and follow https://libretto.sh/start.md to set up Libretto and create a new browser automation.";

export function InstallSnippet({
  prompt = PROMPT,
  fathomEvent = "Hero copy prompt click",
}: {
  prompt?: string;
  fathomEvent?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="install-prompt inline-flex max-w-full items-stretch overflow-hidden">
      <span className="install-prompt__snippet" aria-hidden="true">
        <span className="install-prompt__snippet-text">{prompt}</span>
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
