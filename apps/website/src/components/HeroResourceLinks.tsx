const TALK_TO_A_DEV_URL = "https://cal.com/team/libretto/demo";

interface HeroResourceLinksProps {
  docsHref: string;
  docsFathomEvent: string;
  talkFathomEvent: string;
}

const linkClass =
  "text-muted underline decoration-muted/60 underline-offset-4 transition-colors hover:text-accent-bright hover:decoration-accent/60";

export function HeroResourceLinks({
  docsHref,
  docsFathomEvent,
  talkFathomEvent,
}: HeroResourceLinksProps) {
  const resolvedDocsHref =
    import.meta.env.DEV && docsHref.startsWith("/docs/")
      ? `http://localhost:3000${docsHref}`
      : docsHref;

  return (
    <div className="flex w-full items-center justify-center gap-2 font-mono text-[11px]">
      <a
        href={resolvedDocsHref}
        className={linkClass}
        data-fathom-event={docsFathomEvent}
      >
        Docs
      </a>
      <span aria-hidden="true" className="text-faint">
        ·
      </span>
      <a
        href={TALK_TO_A_DEV_URL}
        className={linkClass}
        data-fathom-event={talkFathomEvent}
      >
        Talk to a dev
      </a>
    </div>
  );
}
