import { useEffect, useState } from "react";

interface ReleaseInfo {
  tagName: string;
  publishedAt: Date;
  url: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
});

const relativeTimeUnits = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatRelativeTime(date: Date) {
  const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(elapsedSeconds);

  for (const { unit, seconds } of relativeTimeUnits) {
    if (absoluteSeconds >= seconds) {
      return relativeTimeFormatter.format(
        Math.round(elapsedSeconds / seconds),
        unit,
      );
    }
  }

  return "less than 1 minute ago";
}

function useLatestRelease(repo: string) {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((r) => r.json())
      .then((data) => {
        if (
          isObject(data) &&
          typeof data.tag_name === "string" &&
          typeof data.html_url === "string" &&
          typeof data.published_at === "string"
        ) {
          const publishedAt = new Date(data.published_at);
          if (Number.isNaN(publishedAt.getTime())) {
            return;
          }

          setRelease({
            tagName: data.tag_name,
            publishedAt,
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
        <span className="tabular-nums">
          {release.tagName} released {formatRelativeTime(release.publishedAt)}
        </span>
      </a>
    </div>
  );
}
