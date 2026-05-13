import { useEffect, useRef } from "react";
import { SectionHeading } from "./SectionHeading";
import { Text } from "./Text";

const MATRIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=<>{}[]|/\\~";
const STREAK_LENGTH = 12;

function MatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const CELL = 8;
    let cols = 0;
    let rows = 0;
    // Each column has a "drop" that falls down, leaving a fading trail
    let drops: { y: number; speed: number; chars: string[] }[] = [];

    function randomChar() {
      return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(rect.width / CELL);
      rows = Math.ceil(rect.height / CELL);
      drops = Array.from({ length: cols }, () => ({
        y: Math.random() * rows * 2 - rows, // stagger start positions, some offscreen
        speed: 0.10 + Math.random() * 0.18,
        chars: Array.from({ length: rows }, randomChar),
      }));
    }

    resize();
    window.addEventListener("resize", resize);

    function draw() {
      const rect = canvas!.getBoundingClientRect();
      ctx!.clearRect(0, 0, rect.width, rect.height);
      ctx!.font = `${CELL - 2}px ui-monospace, "SF Mono", monospace`;
      ctx!.textBaseline = "top";

      for (let x = 0; x < cols; x++) {
        const drop = drops[x];
        drop.y += drop.speed;

        // Reset when the tail is fully past the bottom
        if (drop.y - STREAK_LENGTH > rows) {
          drop.y = -STREAK_LENGTH - Math.random() * rows;
          drop.speed = 0.08 + Math.random() * 0.15;
          drop.chars = Array.from({ length: rows }, randomChar);
        }

        const headY = Math.floor(drop.y);

        for (let y = 0; y < rows; y++) {
          const dist = headY - y;
          if (dist < 0 || dist > STREAK_LENGTH) {
            // Background: very faint static char
            ctx!.fillStyle = "rgba(140, 230, 120, 0.045)";
            ctx!.fillText(drop.chars[y], x * CELL, y * CELL);
            continue;
          }

          // Head of the streak is brightest
          const t = dist / STREAK_LENGTH;
          if (dist === 0) {
            // Randomly mutate the head character
            if (Math.random() < 0.3) drop.chars[y] = randomChar();
            ctx!.fillStyle = "rgba(200, 255, 200, 0.32)";
          } else {
            const alpha = 0.20 * (1 - t * t);
            ctx!.fillStyle = `rgba(140, 230, 120, ${alpha})`;
          }
          ctx!.fillText(drop.chars[y], x * CELL, y * CELL);
        }
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

const integrationTree = [
  {
    group: "healthcare",
    sites: ["athenahealth.com", "eclinicalworks.com", "uhc.com", "availity.com"],
  },
  {
    group: "social",
    sites: ["linkedin.com", "reddit.com", "x.com"],
  },
  {
    group: "ecommerce",
    sites: ["ebay.com", "craigslist.org"],
  },
];

export function BattleTestedBanner() {
  return (
    <section className="relative overflow-hidden py-16" style={{ background: "#000" }}>
      <MatrixBackground />
      <div className="relative z-10 mx-auto max-w-[1000px] px-8">
        <div className="flex flex-col gap-12 md:flex-row md:items-center md:justify-between md:gap-16">
          {/* Text — left */}
          <div className="space-y-4 md:max-w-[440px]">
            <SectionHeading size="sm">
              Battle-tested on the worst of the web
            </SectionHeading>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              Libretto was initially built as an internal tool for automating
              complex healthcare portals where nothing else worked.
            </Text>
            <Text as="p" size="md" className="leading-relaxed text-muted">
              It&apos;s built to handle shadow DOMs, iframes, bot detection, and
              unusable APIs.
            </Text>
          </div>

          {/* Integration logos — 2-column grid on all breakpoints, below text on mobile */}
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="font-mono text-base">
              {integrationTree.map((group, gi) => (
                <div key={group.group} className={gi > 0 ? "mt-3" : ""}>
                  <div className="text-faint">{group.group}/</div>
                  {group.sites.map((url, si) => {
                    const isLast = si === group.sites.length - 1;
                    return (
                      <div key={url} className="flex items-center">
                        <span className="text-faint w-4 text-center">{isLast ? "└" : "├"}</span>
                        <span className="ml-1 text-muted">{url}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <p className="mt-4 text-faint">...and many more</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
