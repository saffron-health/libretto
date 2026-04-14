import { useEffect, useState } from "react";
import { RELEASES_URL } from "../site";

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
    return null;
  }

  return (
    <div className="mb-8 flex items-center justify-center">
      <a
        href={release.url || RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-ink/[0.06] px-3 py-1 font-mono text-[11px] text-ink/50 backdrop-blur-sm transition-colors hover:text-ink"
      >
        <span className="tabular-nums">{release.tagName}</span>
      </a>
    </div>
  );
}
