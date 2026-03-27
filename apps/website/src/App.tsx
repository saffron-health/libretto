import { useEffect, useRef, useState } from "react";
import { CanvasAsciiIcosahedron } from "./components/CanvasAsciiIcosahedron";
import { Button } from "./components/Button";
import { Text } from "./components/Text";
import { TerminalDemo } from "./components/TerminalDemo";
import { InstallSnippet } from "./components/InstallSnippet";
import { GitHubStarIcon } from "./icons";

function useGitHubStars(repo: string) {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`)
      .then((r) => r.json())
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
    <nav className="px-8 pt-6">
      <div className="relative mx-auto flex max-w-[1200px] items-center justify-between">
        <div className="flex items-center gap-10">
          <a href="/" className="no-underline">
            <Text size="xl" style="serif" className="text-ink font-[200]">
              Libretto
            </Text>
          </a>
          <div className="absolute left-1/2 -translate-x-1/2 flex gap-7">
            <a href="#" className="no-underline">
              <Text size="sm" className="font-medium text-ink">
                Forum
              </Text>
            </a>
            <a href="#" className="no-underline">
              <Text size="sm" className="font-medium text-ink">
                Changelog
              </Text>
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/saffron-health/libretto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink/70 hover:text-ink transition-colors"
          >
            <GitHubStarIcon width={15} height={15} />
            {stars !== null && (
              <span className="text-sm font-medium">{formatStars(stars)}</span>
            )}
          </a>
          <Button
            size="sm"
            className="rounded-full bg-ink border-ink px-5 py-2.5 text-cream hover:bg-ink/90"
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
      className="relative px-8 pt-24 pb-16 overflow-hidden"
    >
      {/* Interactive ASCII icosahedron background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.08] -translate-y-24 select-none">
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
          className="mb-8 max-w-[800px] text-center tracking-[-0.03em] text-ink [text-wrap:balance] mx-auto"
        >
          <span
            className="grain"
            style={{
              fontWeight: 300,
              fontSize: "clamp(48px, 6vw, 72px)",
              lineHeight: 1.1,
            }}
          >
            The AI Toolkit for Building Robust Web Integrations
          </span>
        </Text>
        <Text
          as="p"
          size="lg"
          className="mb-8 max-w-[560px] mx-auto text-center leading-relaxed text-muted"
        >
          An agent skill and token-efficient CLI that inspects live pages,
          reverse-engineers network requests, and ships production-ready
          integration workflows.
        </Text>
        <InstallSnippet />
        <div className="flex items-center justify-center gap-6 mb-16">
          <Button className="rounded-full bg-ink border-ink px-7 py-3 text-cream hover:bg-ink/90">
            Go to docs
          </Button>
        </div>
        <TerminalDemo />
      </div>
    </section>
  );
}

export function App() {
  return (
    <div className="h-screen overflow-hidden bg-cream text-ink">
      <Navbar />
      <Hero />
    </div>
  );
}
