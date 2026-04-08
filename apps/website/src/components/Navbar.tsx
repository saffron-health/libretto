import { useEffect, useState } from "react";
import { Text } from "./Text";
import { Button } from "./Button";
import { GitHubStarIcon } from "../icons";
import { AnimationTarget } from "./AnimationOrchestration";
import { DISCUSSIONS_URL, RELEASES_URL, REPO_URL } from "../site";
import { AppLink } from "../routing";

function useGitHubStars(repo: string) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`)
      .then((response) => response.json())
      .then((data) => {
        if (typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
  }, [repo]);

  return stars;
}

function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  return String(count);
}

export function Navbar({ animate = false }: { animate?: boolean }) {
  const stars = useGitHubStars("saffron-health/libretto");

  const animateProps = animate
    ? { "data-animate": AnimationTarget.Navbar, style: { opacity: 0 } as const }
    : {};

  return (
    <nav {...animateProps} className="px-8 pt-6">
      <div className="relative mx-auto flex max-w-[800px] items-center justify-between">
        <div className="flex items-center gap-10">
          <AppLink href="/" className="no-underline">
            <Text size="xl" style="serif" className="text-ink font-[200]">
              Libretto
            </Text>
          </AppLink>
          <div className="absolute left-1/2 flex -translate-x-1/2 gap-7">
            <a
              href={DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
            >
              <Text size="sm" className="font-medium text-ink">
                Forum
              </Text>
            </a>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
            >
              <Text size="sm" className="font-medium text-ink">
                Changelog
              </Text>
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink/70 transition-colors hover:text-ink"
          >
            <GitHubStarIcon width={15} height={15} />
            {stars !== null && (
              <span className="text-sm font-medium">{formatStars(stars)}</span>
            )}
          </a>
          <Button href="/docs/get-started/introduction" size="sm">
            Go to docs
          </Button>
        </div>
      </div>
    </nav>
  );
}
