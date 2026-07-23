export function GitHubPRMock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-rule bg-panel/70 shadow-lg shadow-black/30 ${className}`.trim()}
    >
      <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-9/20 px-2.5 py-1 text-xs font-medium text-accent-bright">
          <span className="size-1.5 rounded-full bg-accent-bright" />
          Open
        </span>
        <span className="truncate text-sm font-semibold text-ink">
          Libretto autofix for Playwright failure
        </span>
      </div>
      <div className="px-4 py-3 text-xs text-muted">
        <span className="font-mono text-accent-bright">libretto-agent</span>{" "}
        wants to merge 1 commit into{" "}
        <span className="font-mono text-ink">main</span>
      </div>
      <div className="border-t border-rule bg-bg/70 px-4 py-3">
        <div className="mb-2 font-mono text-[11px] text-muted">
          workflows/book-appointment.ts
        </div>
        <div className="overflow-hidden rounded-md border border-rule font-mono text-xs leading-5">
          <div className="bg-red-500/10 px-3 py-1 text-red-300">
            {`- await page.locator('input[name="username"]').fill(login);`}
          </div>
          <div className="bg-green-9/15 px-3 py-1 text-accent-bright">
            {`+ await page.locator('input[name="login"]').fill(login);`}
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          The sign-in field is{" "}
          <span className="font-mono text-ink">name=&quot;login&quot;</span>,
          confirmed by inspecting the live page.
        </p>
      </div>
    </div>
  );
}
