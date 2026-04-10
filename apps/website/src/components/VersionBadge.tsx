import { useEffect, useState } from "react";

function useNpmVersion(pkg: string) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch(`https://registry.npmjs.org/${pkg}/latest`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.version === "string") {
          setVersion(data.version);
        }
      })
      .catch(() => {});
  }, [pkg]);

  return version;
}

export function VersionBadge() {
  const version = useNpmVersion("libretto");

  return (
    <div className="mb-8 flex items-center justify-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-ink/[0.06] px-3 py-1 font-mono text-[11px] backdrop-blur-sm">
        <span className="font-medium uppercase tracking-widest text-ink/60">
          Beta
        </span>
        {version !== null && (
          <>
            <span className="inline-block size-1 rounded-full bg-ink/20" />
            <span className="tabular-nums text-ink/50">v{version}</span>
          </>
        )}
      </div>
    </div>
  );
}
