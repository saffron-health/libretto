import { useEffect, useState } from "react";

interface ReleaseInfo {
  tagName: string;
  url: string;
}

function useLatestRelease(repo: string) {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.tag_name === "string" && typeof data.html_url === "string") {
          setRelease({
            tagName: data.tag_name,
            url: data.html_url,
          });
        }
      })
      .catch(() => {});
  }, [repo]);

  return release;
}

export function VersionBadge() {
  const release = useLatestRelease("saffron-health/libretto");

  if (release === null) {
    return <div className="mb-8 h-[26px]" />;
  }

  return (
    <div className="mb-8 flex items-center justify-center">
      <a
        href={release.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 font-mono text-[11px] text-accent/70 backdrop-blur-sm transition-colors hover:text-accent-bright"
      >
        <span className="tabular-nums">{release.tagName} now available</span>
      </a>
    </div>
  );
}
