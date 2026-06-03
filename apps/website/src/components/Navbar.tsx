import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "./Text";
import { Button } from "./Button";
import { GitHubStarIcon, NpmIcon } from "../icons";
import { AnimationTarget } from "./AnimationOrchestration";
import { DISCUSSIONS_URL, NPM_URL, RELEASES_URL, REPO_URL } from "../site";
import { AppLink } from "../routing";
import { MobileMenu } from "./MobileMenu";
import { LibrettoLogoMark, LibrettoWordmark } from "../brand.js";

const GLITCH_CHARS = "@#$%&*+=<>{}[]|/\\~^!?";

function useGlitchText(text: string) {
  const [display, setDisplay] = useState(text);
  const [hovered, setHovered] = useState(false);
  const rafRef = useRef<number>(0);

  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => {
    setHovered(false);
    setDisplay(text);
    cancelAnimationFrame(rafRef.current);
  }, [text]);

  useEffect(() => {
    if (!hovered) return;

    const chars = text.split("");
    // Each character gets a random settle time (in ms)
    const settleTimes = chars.map(() => 150 + Math.random() * 350);
    const start = performance.now();
    let settled = false;

    let lastUpdate = 0;
    const INTERVAL = 60; // ms between character changes

    function tick(now: number) {
      const elapsed = now - start;

      if (now - lastUpdate >= INTERVAL) {
        lastUpdate = now;
        const result = chars.map((ch, i) => {
          if (ch === " ") return " ";
          if (elapsed >= settleTimes[i]) return ch;
          return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
        });
        setDisplay(result.join(""));

        if (result.every((ch, i) => ch === chars[i])) {
          settled = true;
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (!settled) cancelAnimationFrame(rafRef.current);
    };
  }, [hovered, text]);

  const isScrambling = hovered && display !== text;

  return { display, isScrambling, hovered, onEnter, onLeave };
}

function GlitchNavLink({
  href,
  children,
  external = true,
  fathomEvent,
}: {
  href: string;
  children: string;
  external?: boolean;
  fathomEvent: string;
}) {
  const { display, isScrambling, hovered, onEnter, onLeave } = useGlitchText(children);

  return (
    <AppLink
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="no-underline"
      data-fathom-event={fathomEvent}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Text
        size="sm"
        className={`font-medium transition-colors duration-75 ${
          isScrambling ? "text-amber font-mono" : hovered ? "text-accent-bright" : "text-ink"
        }`}
      >
        {display}
      </Text>
    </AppLink>
  );
}

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
          <AppLink href="/" className="flex items-center gap-2 no-underline">
            <LibrettoLogoMark variant="dark" className="size-[1.35rem] shrink-0" />
            <LibrettoWordmark className="shrink-0 text-[1.5rem]" />
          </AppLink>
          <div className="absolute left-1/2 hidden -translate-x-1/2 gap-7 md:flex">
            <GlitchNavLink href="/blog" external={false} fathomEvent="Nav blog click">
              Blog
            </GlitchNavLink>
            <GlitchNavLink href="/#pricing" external={false} fathomEvent="Nav pricing click">
              Pricing
            </GlitchNavLink>
            <GlitchNavLink href={DISCUSSIONS_URL} fathomEvent="Nav forum click">
              Forum
            </GlitchNavLink>
            <GlitchNavLink href={RELEASES_URL} fathomEvent="Nav changelog click">
              Changelog
            </GlitchNavLink>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on npm"
            className="hidden text-ink/70 transition-colors hover:text-ink md:flex"
            data-fathom-event="Nav npm click"
          >
            <NpmIcon width={36} height={14} />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 text-ink/70 transition-colors hover:text-ink md:flex"
            data-fathom-event="Nav github click"
          >
            <GitHubStarIcon width={15} height={15} />
            {stars !== null && <span className="text-sm font-medium">{formatStars(stars)}</span>}
          </a>
          <Button href="/docs/get-started/quickstart" size="sm" data-fathom-event="Nav docs click">
            Go to docs
          </Button>
          <div className="md:hidden">
            <MobileMenu stars={stars !== null ? formatStars(stars) : null} />
          </div>
        </div>
      </div>
    </nav>
  );
}
