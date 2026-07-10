import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "./Text";
import { DiscordIcon, GitHubIcon, NpmIcon } from "../icons";
import { DISCORD_URL, DISCUSSIONS_URL, NPM_URL, RELEASES_URL, REPO_URL } from "../site";
import { LIBRETTO_ASCII_NAME, LIBRETTO_ASCII_NAME_COLS } from "../brand.js";

const linkClass = "text-muted/60 transition-colors hover:text-accent-bright text-xs no-underline";

function useLogoFontSize() {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(16);

  const recalc = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    // Measure how wide one character is at 16px
    measure.style.fontSize = "16px";
    const charWidth = measure.getBoundingClientRect().width;
    if (charWidth === 0) return;
    const ratio = charWidth; // width of one char at 16px
    const targetWidth = container.getBoundingClientRect().width;
    const size = (targetWidth / (LIBRETTO_ASCII_NAME_COLS * ratio)) * 16;
    setFontSize(Math.max(6, size));
  }, []);

  useEffect(() => {
    recalc();
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc]);

  return { containerRef, measureRef, fontSize };
}

export function Footer() {
  const { containerRef, measureRef, fontSize } = useLogoFontSize();

  return (
    <footer className="relative overflow-hidden pt-20">
      <div className="mx-auto max-w-[800px] px-8">
        {/* Row 1: copyright + sitemap */}
        <div className="flex items-start justify-between gap-8">
          <Text size="xs" className="text-muted/50">
            © {new Date().getFullYear()} Saffron Health
          </Text>
          <div className="flex gap-6">
            <a href="/blog" className={linkClass} data-fathom-event="Footer blog click">
              Blog
            </a>
            <a
              href="/#comparisons"
              className={linkClass}
              data-fathom-event="Footer comparisons click"
            >
              Comparisons
            </a>
            <a
              href="/docs/get-started/quickstart"
              className={linkClass}
              data-fathom-event="Footer docs click"
            >
              Docs
            </a>
            <a
              href={DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              data-fathom-event="Footer forum click"
            >
              Forum
            </a>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              data-fathom-event="Footer changelog click"
            >
              Changelog
            </a>
          </div>
        </div>

        {/* Row 2: social links */}
        <div className="mt-4 flex items-center gap-3">
          <a
            href={NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on npm"
            className="text-muted/50 transition-colors hover:text-muted"
            data-fathom-event="Footer npm click"
          >
            <NpmIcon width={28} height={12} />
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on Discord"
            className="text-muted/50 transition-colors hover:text-muted"
            data-fathom-event="Footer discord click"
          >
            <DiscordIcon width={14} height={14} />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Libretto on GitHub"
            className="text-muted/50 transition-colors hover:text-muted"
            data-fathom-event="Footer github click"
          >
            <GitHubIcon width={14} height={14} />
          </a>
        </div>
        {/* Hidden measurement span for monospace char width */}
        <span
          ref={measureRef}
          className="pointer-events-none invisible fixed font-mono leading-none tracking-[0]"
          style={{ fontSize: 16, whiteSpace: "pre" }}
          aria-hidden="true"
        >
          M
        </span>

        {/* Giant hollow LIBRETTO with scanlines — fills content width */}
        <div
          ref={containerRef}
          className="mt-12 flex translate-y-[4px] justify-center overflow-hidden"
          style={{ lineHeight: 0 }}
        >
          <pre
            aria-hidden="true"
            className="footer-hollow-logo whitespace-pre font-mono leading-none tracking-[0] select-none"
            style={{ fontSize }}
          >
            {LIBRETTO_ASCII_NAME}
          </pre>
        </div>
      </div>
    </footer>
  );
}
