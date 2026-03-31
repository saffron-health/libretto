import sharp from "sharp";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Env tunables
// ---------------------------------------------------------------------------

const MAX_SCREENSHOTS = Number(process.env.BENCH_MAX_SCREENSHOTS) || 7;
const SCREENSHOT_INTERVAL_MS =
  Number(process.env.BENCH_SCREENSHOT_INTERVAL_MS) || 3000;
const SCREENSHOT_SCALE = Number(process.env.BENCH_SCREENSHOT_SCALE) || 0.7;

// MSE threshold – pairs below this are considered duplicates.
const MSE_THRESHOLD = 30;
// Thumbnail dimensions used for dedup comparison (fast path).
const THUMB_WIDTH = 400;
const THUMB_HEIGHT = 300;

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

export async function imageResize(
  img: Buffer,
  scaleFactor: number,
): Promise<Buffer> {
  const metadata = await sharp(img).metadata();
  if (metadata.width && metadata.height) {
    const width = Math.round(metadata.width * scaleFactor);
    const height = Math.round(metadata.height * scaleFactor);
    return await sharp(img)
      .resize(width, height, { fit: "inside", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true })
      .toBuffer();
  }
  return img;
}

async function toThumbnailRaw(img: Buffer): Promise<Buffer> {
  return sharp(img)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer();
}

function computeMSE(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum / a.length;
}

// ---------------------------------------------------------------------------
// Session state reader (minimal, avoid importing the full CLI)
// ---------------------------------------------------------------------------

function readCdpEndpoint(runDir: string, session: string): string | null {
  try {
    const statePath = join(
      runDir,
      ".libretto",
      "sessions",
      session,
      "state.json",
    );
    const raw = readFileSync(statePath, "utf8");
    const state = JSON.parse(raw) as {
      cdpEndpoint?: string;
      port?: number;
    };
    return (
      state.cdpEndpoint ??
      (state.port ? `http://localhost:${state.port}` : null)
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ScreenshotCollector
// ---------------------------------------------------------------------------

export type CollectedScreenshot = {
  /** Full-resolution PNG buffer (before resize). */
  original: Buffer;
  /** Timestamp of capture. */
  capturedAt: Date;
};

export class ScreenshotCollector {
  private screenshots: CollectedScreenshot[] = [];
  private lastThumb: Buffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private capturing = false;
  private stopped = false;
  private readonly sessionName: string;
  private readonly runDir: string;
  private readonly maxScreenshots: number;
  private readonly intervalMs: number;

  constructor(
    sessionName: string,
    runDir: string,
    opts?: { maxScreenshots?: number; intervalMs?: number },
  ) {
    this.sessionName = sessionName;
    this.runDir = runDir;
    this.maxScreenshots = opts?.maxScreenshots ?? MAX_SCREENSHOTS;
    this.intervalMs = opts?.intervalMs ?? SCREENSHOT_INTERVAL_MS;
  }

  /** Begin periodic screenshot capture. */
  start(): void {
    if (this.stopped) return;
    // Take initial screenshot then start interval
    void this.capture();
    this.timer = setInterval(() => void this.capture(), this.intervalMs);
  }

  /** Stop capturing and return the deduplicated, resized screenshot buffers. */
  async stop(): Promise<Buffer[]> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // One final capture attempt
    await this.capture();

    // Resize all kept screenshots
    const resized = await Promise.all(
      this.screenshots.map((s) => imageResize(s.original, SCREENSHOT_SCALE)),
    );

    // Clear internal state
    this.screenshots = [];
    this.lastThumb = null;

    return resized;
  }

  private async capture(): Promise<void> {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const buf = await this.takeScreenshot();
      if (!buf) return;

      // Dedup via MSE on thumbnails
      const thumb = await toThumbnailRaw(buf);
      if (this.lastThumb) {
        const mse = computeMSE(this.lastThumb, thumb);
        if (mse < MSE_THRESHOLD) return; // too similar, skip
      }

      this.lastThumb = thumb;
      this.screenshots.push({ original: buf, capturedAt: new Date() });

      // Cap – drop oldest when over limit
      while (this.screenshots.length > this.maxScreenshots) {
        this.screenshots.shift();
      }
    } catch {
      // Browser not ready yet or disconnected – silently ignore
    } finally {
      this.capturing = false;
    }
  }

  private async takeScreenshot(): Promise<Buffer | null> {
    const endpoint = readCdpEndpoint(this.runDir, this.sessionName);
    if (!endpoint) return null;

    let browser: Browser | null = null;
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
      const contexts = browser.contexts();
      if (contexts.length === 0) return null;

      const pages = contexts.flatMap((c) => c.pages());
      const page = pages.find((p) => {
        const url = p.url();
        return url && !url.startsWith("chrome://") && !url.startsWith("about:");
      });
      if (!page) return null;

      return (await page.screenshot({ type: "png" })) as Buffer;
    } catch {
      return null;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }
}
