import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "./Text";
import { Button } from "./Button";
import { GitHubStarIcon } from "../icons";
import { AnimationTarget } from "./AnimationOrchestration";
import { RELEASES_URL, REPO_URL } from "../site";
import { MobileMenu } from "./MobileMenu";
import { LibrettoLogoAndName } from "../brand.js";
import { getCloudSession, type CloudSession } from "../cloudApi";

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
    const settleTimes = chars.map(() => 150 + Math.random() * 350);
    const start = performance.now();
    let settled = false;

    let lastUpdate = 0;
    const INTERVAL = 60;

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

function ExternalIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M6 4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h6A1.5 1.5 0 0 0 12 11.5V10" />
      <path d="M9 3h4v4" />
      <path d="m8 8 5-5" />
    </svg>
  );
}

function GlitchNavLink({
  href,
  children,
  external = true,
  trailingIcon = false,
  fathomEvent,
}: {
  href: string;
  children: string;
  external?: boolean;
  trailingIcon?: boolean;
  fathomEvent: string;
}) {
  const { display, isScrambling, hovered, onEnter, onLeave } =
    useGlitchText(children);

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="flex h-[1.9375rem] items-center no-underline"
      data-fathom-event={fathomEvent}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span
        className={`inline-flex items-center gap-1.5 transition-colors duration-75 ${
          isScrambling
            ? "text-amber"
            : hovered
              ? "text-accent-bright"
              : "text-ink"
        }`}
      >
        <Text
          size="sm"
          className={`font-medium leading-none ${
            isScrambling ? "font-mono" : ""
          }`}
        >
          {display}
        </Text>
        {trailingIcon && <ExternalIcon />}
      </span>
    </a>
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

function userInitial(session: CloudSession): string {
  return session.user.email.slice(0, 1).toUpperCase();
}

function CloudAccountLink({ session }: { session: CloudSession | null }) {
  if (!session) {
    return (
      <Button
        href="/signin?mode=signup"
        size="sm"
        data-fathom-event="Nav cloud sign up click"
      >
        Cloud sign in/up
      </Button>
    );
  }

  return (
    <a
      href="/dashboard"
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule bg-panel px-3 text-sm text-ink no-underline transition-colors hover:border-accent/45 hover:bg-panel-hi"
      data-fathom-event="Nav dashboard click"
      aria-label={`Open dashboard for ${session.user.email}`}
      title={session.user.email}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/35 bg-green-9/15 font-mono text-xs text-accent-bright">
        {userInitial(session)}
      </span>
      <span>Dashboard</span>
    </a>
  );
}

export function Navbar({ animate = false }: { animate?: boolean }) {
  const stars = useGitHubStars("saffron-health/libretto");
  const [session, setSession] = useState<CloudSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCloudSession()
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const animateProps = animate
    ? { "data-animate": AnimationTarget.Navbar, style: { opacity: 0 } as const }
    : {};

  return (
    <nav {...animateProps} className="px-4 pt-6 md:px-8">
      <div className="relative mx-auto flex max-w-[980px] items-center justify-between">
        <div className="flex items-center gap-6">
          <a
            href="/"
            className="flex h-[1.9375rem] -translate-y-px items-center no-underline lg:-translate-y-[2.5px]"
          >
            <LibrettoLogoAndName />
          </a>
          <div className="hidden items-center gap-6 lg:flex">
            <GlitchNavLink
              href="/docs/get-started/quickstart"
              external={false}
              trailingIcon
              fathomEvent="Nav docs click"
            >
              Docs
            </GlitchNavLink>
            <GlitchNavLink
              href="/blog"
              external={false}
              fathomEvent="Nav blog click"
            >
              Blog
            </GlitchNavLink>
            <GlitchNavLink
              href={RELEASES_URL}
              fathomEvent="Nav changelog click"
            >
              Changelog
            </GlitchNavLink>
          </div>
        </div>
        <div className="flex items-center gap-3 md:gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-[1.9375rem] items-center gap-1.5 text-ink/70 transition-colors hover:text-ink lg:flex"
            data-fathom-event="Nav github click"
          >
            <GitHubStarIcon width={15} height={15} />
            {stars !== null && (
              <span className="text-sm font-medium">{formatStars(stars)}</span>
            )}
          </a>
          <div className="hidden sm:block">
            <CloudAccountLink session={session} />
          </div>
          <div className="lg:hidden">
            <MobileMenu
              stars={stars !== null ? formatStars(stars) : null}
              session={session}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
