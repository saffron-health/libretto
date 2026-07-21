import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
  Button as AriaButton,
} from "react-aria-components";
import { Text } from "./Text";
import { Button } from "./Button";
import { GitHubStarIcon } from "../icons";
import { AnimationTarget } from "./AnimationOrchestration";
import { RELEASES_URL, REPO_URL } from "../site";
import { MobileMenu } from "./MobileMenu";
import { LibrettoLogoAndName } from "../brand.js";
import {
  authPost,
  getCloudSession,
  getSetupStatus,
  type CloudSession,
} from "../cloudApi";

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

function getCurrentPageLabel(): string {
  if (typeof window === "undefined") return "Dashboard";
  const pathname = window.location.pathname;
  if (pathname === "/dashboard/cloud-browsers") return "Cloud Browsers";
  if (pathname === "/dashboard") return "PR Agents";
  if (
    pathname === "/setup" ||
    pathname === "/github/setup" ||
    pathname === "/onboarding"
  ) {
    return "Setup";
  }
  return "Dashboard";
}

function PullRequestIcon() {
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
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M4 5.6v4.8" />
      <path d="M12 10.4V7.8A3.8 3.8 0 0 0 8.2 4H7" />
      <path d="m8.2 2.4-1.6 1.6 1.6 1.6" />
    </svg>
  );
}

function SignOutIcon() {
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
      <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
      <path d="M10.5 11 14 8l-3.5-3" />
      <path d="M14 8H6" />
    </svg>
  );
}

function CloudBrowserIcon() {
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
      <path d="M5 11.5H4.2A3.2 3.2 0 0 1 4.1 5.1 4.4 4.4 0 0 1 12.5 7a2.3 2.3 0 0 1-.3 4.5H11" />
      <path d="M6 9.5h4v3H6z" />
      <path d="M7.2 12.5h1.6" />
    </svg>
  );
}

function SetupIcon() {
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
      <path d="M3 4.5h10" />
      <path d="M3 8h10" />
      <path d="M3 11.5h5" />
      <path d="m10.5 11.2 1.2 1.2 2-2.4" />
    </svg>
  );
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
  const [pageLabel, setPageLabel] = useState("Dashboard");
  const [signingOut, setSigningOut] = useState(false);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    setPageLabel(getCurrentPageLabel());
  }, []);

  useEffect(() => {
    if (!session) {
      setSetupComplete(null);
      return;
    }

    let cancelled = false;
    setSetupComplete(null);
    getSetupStatus()
      .then((status) => {
        if (!cancelled) setSetupComplete(status.setup_complete);
      })
      .catch(() => {
        if (!cancelled) setSetupComplete(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  async function signOut() {
    setSigningOut(true);
    try {
      await authPost("/api/auth/sign-out", {});
      window.location.assign("/");
    } catch {
      setSigningOut(false);
    }
  }

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
    <MenuTrigger>
      <AriaButton
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule bg-panel px-3 text-sm text-ink outline-none transition-colors hover:border-accent/45 hover:bg-panel-hi focus-visible:ring-2 focus-visible:ring-accent/40"
        data-fathom-event="Nav dashboard menu click"
        aria-label={`Open account menu for ${session.user.email}`}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/35 bg-green-9/15 font-mono text-xs text-accent-bright">
          {userInitial(session)}
        </span>
        <span className="hidden max-w-[180px] truncate sm:block">
          {pageLabel}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="hidden size-3.5 text-muted sm:block"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </AriaButton>
      <Popover placement="bottom end" offset={6} className="z-50 outline-none">
        <Menu className="w-[300px] rounded-lg border border-rule bg-panel p-1 shadow-lg shadow-black/35 outline-none">
          <DashboardMenuItem
            href="/dashboard"
            icon={<PullRequestIcon />}
            title="PR Agents"
            description="Auto-fix failing workflows"
            fathomEvent="Nav PR agents dashboard click"
            current={pageLabel === "PR Agents"}
          />
          <DashboardMenuItem
            href="/dashboard/cloud-browsers"
            icon={<CloudBrowserIcon />}
            title="Cloud Browsers"
            description="Run automations on managed browsers"
            fathomEvent="Nav cloud browsers dashboard click"
            current={pageLabel === "Cloud Browsers"}
          />
          {setupComplete === false && (
            <DashboardMenuItem
              href="/setup"
              icon={<SetupIcon />}
              title="Setup"
              description="Finish workspace setup"
              fathomEvent="Nav setup click"
              current={pageLabel === "Setup"}
            />
          )}
          <Separator className="mx-2 my-1 h-px bg-rule" />
          <MenuSection className="rounded-md bg-ink/[0.04] p-1">
            <MenuItem
              id="account-email"
              isDisabled
              className="grid cursor-default grid-cols-[28px_1fr] items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:opacity-100"
              textValue={session.user.email}
            >
              <span className="grid size-7 place-items-center rounded-full border border-accent/35 bg-green-9/15 font-mono text-xs text-accent-bright">
                {userInitial(session)}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">
                  Signed in as
                </span>
                <span className="block truncate text-xs text-ink">
                  {session.user.email}
                </span>
              </span>
            </MenuItem>
            <MenuItem
              id="signout"
              onAction={signOut}
              isDisabled={signingOut}
              className="grid cursor-pointer grid-cols-[28px_1fr] items-center gap-2 rounded-md px-2 py-2 text-sm text-muted outline-none transition-colors data-[disabled]:cursor-default data-[disabled]:opacity-60 data-[focused]:bg-ink/[0.07] data-[focused]:text-ink data-[pressed]:bg-ink/[0.1]"
              data-fathom-event="Nav sign out click"
            >
              <span className="grid size-7 place-items-center">
                <SignOutIcon />
              </span>
              <span>{signingOut ? "Signing out..." : "Sign out"}</span>
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
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
