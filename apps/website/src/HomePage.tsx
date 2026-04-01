import { useEffect, useRef, useState } from "react";
import { CanvasAsciiIcosahedron } from "./components/CanvasAsciiIcosahedron";
import { Button } from "./components/Button";
import { Text } from "./components/Text";
import { TerminalDemo } from "./components/TerminalDemo";
import { InstallSnippet } from "./components/InstallSnippet";
import { GitHubStarIcon } from "./icons";
import {
  OrchestrationContainer,
  AnimationTarget,
} from "./components/AnimationOrchestration";
import { AnimatedTitle } from "./components/AnimatedTitle";
import { DISCUSSIONS_URL, RELEASES_URL, REPO_URL } from "./site";
import { AppLink } from "./routing";

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

function Navbar() {
  const stars = useGitHubStars("saffron-health/libretto");

  return (
    <nav
      data-animate={AnimationTarget.Navbar}
      style={{ opacity: 0 }}
      className="px-8 pt-6"
    >
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
          <Button
            href="/docs/"
            size="sm"
          >
            Go to docs
          </Button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-8 pt-24 pb-16"
    >
      <div
        data-animate={AnimationTarget.Icosahedron}
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 flex -translate-y-24 items-center justify-center select-none"
      >
        <CanvasAsciiIcosahedron
          className="h-[1600px] w-[1600px] max-h-[180vw] max-w-[180vw] text-ink"
          showAnnotations={false}
          objectScale={1.2}
        />
      </div>
      <div className="relative mx-auto max-w-[1200px]">
        <Text
          as="h1"
          size="5xl"
          style="serif"
          className="mx-auto mb-8 max-w-[800px] text-center tracking-[-0.03em] text-ink [text-wrap:balance]"
        >
          <AnimatedTitle
            className="grain"
            style={{
              fontWeight: 300,
              fontSize: "clamp(48px, 6vw, 72px)",
              lineHeight: 1.1,
            }}
          >
            The AI Toolkit for Building Robust Web Integrations
          </AnimatedTitle>
        </Text>
        <Text
          as="p"
          size="lg"
          data-animate={AnimationTarget.Content}
          htmlStyle={{ opacity: 0 }}
          className="mx-auto mb-8 max-w-[560px] text-center leading-relaxed text-muted"
        >
          An agent skill and token-efficient CLI that inspects live pages,
          reverse-engineers network requests, and ships production-ready
          integration workflows.
        </Text>
        <div data-animate={AnimationTarget.Content} style={{ opacity: 0 }}>
          <InstallSnippet />
        </div>
        <div
          data-animate={AnimationTarget.Content}
          style={{ opacity: 0 }}
          className="mb-16 flex items-center justify-center gap-6"
        >
          <Button
            href="/docs/"
          >
            Go to docs
          </Button>
        </div>
        <div data-animate={AnimationTarget.Content} style={{ opacity: 0 }}>
          <TerminalDemo />
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <OrchestrationContainer className="min-h-screen bg-cream text-ink">
      <Navbar />
      <Hero />
    </OrchestrationContainer>
  );
}
