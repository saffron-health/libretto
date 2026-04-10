import { useEffect, useState } from "react";
import { Text } from "./Text";

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
    <div className="mb-5 flex items-center justify-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-ink/[0.06] px-3.5 py-1.5 backdrop-blur-sm">
        <Text size="xs" className="font-medium tracking-wide text-ink/60">
          beta
        </Text>
        {version !== null && (
          <>
            <span className="inline-block size-1 rounded-full bg-ink/20" />
            <Text size="xs" className="font-medium tabular-nums text-ink/60">
              v{version}
            </Text>
          </>
        )}
      </div>
    </div>
  );
}
