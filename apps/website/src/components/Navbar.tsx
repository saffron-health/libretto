import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Button as AriaButton,
} from "react-aria-components";
import { Text } from "./Text";
import { Button } from "./Button";
import { GitHubStarIcon, YCLogo } from "../icons";
import { AnimationTarget } from "./AnimationOrchestration";
import { RELEASES_URL, REPO_URL, YC_URL } from "../site";
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
  const { display, isScrambling, hovered, onEnter, onLeave } = useGlitchText(children);

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
          isScrambling ? "text-amber" : hovered ? "text-accent-bright" : "text-ink"
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

function YCNavLink() {
  const { display, isScrambling, hovered, onEnter, onLeave } = useGlitchText("P26");

  return (
    <a
      href={YC_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hidden h-[1.9375rem] items-center no-underline lg:flex"
      data-fathom-event="Nav YC click"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span
        className={`inline-flex items-center gap-1.5 transition-colors duration-75 ${
          isScrambling ? "text-amber" : hovered ? "text-accent-bright" : "text-ink"
        }`}
      >
        <YCLogo className="size-3.5 shrink-0" />
        <Text
          size="sm"
          className={`font-medium leading-none ${
            isScrambling ? "font-mono" : ""
          }`}
        >
          {display}
        </Text>
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

function DashboardMenuItem({
  href,
  icon,
  title,
  description,
  fathomEvent,
  current = false,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  fathomEvent: string;
  current?: boolean;
}) {
  return (
    <MenuItem
      href={href}
      className={`grid cursor-pointer grid-cols-[28px_1fr] gap-2 rounded-md px-2 py-2 text-ink outline-none transition-colors data-[focused]:bg-ink/[0.07] data-[pressed]:bg-ink/[0.1] ${
        current ? "bg-green-9/15" : ""
      }`}
      data-fathom-event={fathomEvent}
    >
      <span className="grid size-7 place-items-center rounded-md border border-rule bg-bg/70 text-accent-bright">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-5">
          {title}
        </span>
        <span className="block truncate text-xs leading-4 text-muted">
          {description}
        </span>
      </span>
    </MenuItem>
  );
}

function CliIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M3 4.5 6.5 8 3 11.5" />
      <path d="M8 11.5h5" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <circle cx="8" cy="9" r="3.2" />
      <path d="M8 5.8V4.2" />
      <path d="M4.4 7.2 3 6" />
      <path d="M11.6 7.2 13 6" />
      <path d="M4.4 10.8 3 12" />
      <path d="M11.6 10.8 13 12" />
    </svg>
  );
}

function ToolsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M10.2 3.2a2.4 2.4 0 0 1 2.6 2.6L9.5 9.1 6.9 6.5z" />
      <path d="M6.5 9.5 3.2 12.8" />
      <path d="M4.2 8.2 3 9.4l3.6 3.6 1.2-1.2" />
    </svg>
  );
}

function OpenSourceNavMenu() {
  const { display, isScrambling, hovered, onEnter, onLeave } =
    useGlitchText("Open source");

  return (
    <MenuTrigger>
      <AriaButton
        className="flex h-[1.9375rem] items-center gap-1 outline-none"
        data-fathom-event="Nav open source click"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <span
          className={`inline-flex items-center gap-1 transition-colors duration-75 ${
            isScrambling ? "text-amber" : hovered ? "text-accent-bright" : "text-ink"
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
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 text-muted"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </AriaButton>
      <Popover placement="bottom start" offset={6} className="z-50 outline-none">
        <Menu className="w-[320px] rounded-lg border border-rule bg-panel p-1 shadow-lg shadow-black/35 outline-none">
          <DashboardMenuItem
            href="/cli"
            icon={<CliIcon />}
            title="Libretto CLI"
            description="Turn website workflows into reliable APIs"
            fathomEvent="Nav open source cli click"
          />
          <DashboardMenuItem
            href="/debug-agents"
            icon={<BugIcon />}
            title="Debug Agents"
            description="Failing runs become pull requests"
            fathomEvent="Nav open source debug agents click"
          />
          <DashboardMenuItem
            href="/browser-tools"
            icon={<ToolsIcon />}
            title="Browser Tools SDK"
            description="Browser tools for AI agents"
            fathomEvent="Nav open source browser tools click"
          />
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function CloudAccountLink({ session }: { session: CloudSession | null }) {
  if (!session) {
    return (
      <Button
        href="/signin?mode=signup"
        size="sm"
        data-fathom-event="Nav cloud sign up click"
      >
        Sign in/up
      </Button>
    );
  }

  return (
    <a
      href="/dashboard"
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule bg-panel px-3 text-sm text-ink no-underline outline-none transition-colors hover:border-accent/45 hover:bg-panel-hi focus-visible:ring-2 focus-visible:ring-accent/40"
      data-fathom-event="Nav dashboard click"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/35 bg-green-9/15 font-mono text-xs text-accent-bright">
        {session.user.email.slice(0, 1).toUpperCase()}
      </span>
      Dashboard
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
    <nav
      {...animateProps}
      className="sticky top-0 z-50 px-4 py-4 backdrop-blur-md md:px-8"
    >
      <div className="relative mx-auto flex max-w-[980px] items-center justify-between">
        <div className="flex items-center gap-6">
          <a
            href="/"
            className="flex h-[1.9375rem] -translate-y-px items-center no-underline lg:-translate-y-[2.5px]"
          >
            <LibrettoLogoAndName />
          </a>
          <div className="hidden items-center gap-6 lg:flex">
            <OpenSourceNavMenu />
            <GlitchNavLink
              href="/docs/get-started/quickstart"
              external={false}
              trailingIcon
              fathomEvent="Nav docs click"
            >
              Docs
            </GlitchNavLink>
            <GlitchNavLink href="/blog" external={false} fathomEvent="Nav blog click">
              Blog
            </GlitchNavLink>
            <GlitchNavLink href={RELEASES_URL} fathomEvent="Nav changelog click">
              Changelog
            </GlitchNavLink>
          </div>
        </div>
        <div className="flex items-center gap-3 md:gap-4">
          <YCNavLink />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-[1.9375rem] items-center gap-1.5 text-ink/70 transition-colors hover:text-ink lg:flex"
            data-fathom-event="Nav github click"
          >
            <GitHubStarIcon width={15} height={15} />
            {stars !== null && <span className="text-sm font-medium">{formatStars(stars)}</span>}
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
