import sharp from "sharp";
import { chromium, type Browser } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Env tunables
// ---------------------------------------------------------------------------

const MAX_SCREENSHOTS = Number(process.env.BENCH_MAX_SCREENSHOTS) || 7;
const SCREENSHOT_SCALE = Number(process.env.BENCH_SCREENSHOT_SCALE) || 0.7;
const MSE_THRESHOLD = 30;
const SSIM_THRESHOLD = 0.75;
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

async function computeSSIM(a: Buffer, b: Buffer): Promise<number> {
  const grayA = await sharp(a)
    .resize(THUMB_WIDTH, THUMB_HEIGHT)
    .grayscale()
    .raw()
    .toBuffer();
  const grayB = await sharp(b)
    .resize(THUMB_WIDTH, THUMB_HEIGHT)
    .grayscale()
    .raw()
    .toBuffer();

  if (grayA.length !== grayB.length) {
    return 0;
  }

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;

  let sumA = 0;
  let sumB = 0;
  let sumASquared = 0;
  let sumBSquared = 0;
  let sumAB = 0;
  const count = grayA.length;

  for (let i = 0; i < count; i++) {
    sumA += grayA[i];
    sumB += grayB[i];
    sumASquared += grayA[i] * grayA[i];
    sumBSquared += grayB[i] * grayB[i];
    sumAB += grayA[i] * grayB[i];
  }

  const meanA = sumA / count;
  const meanB = sumB / count;
  const varianceA = sumASquared / count - meanA * meanA;
  const varianceB = sumBSquared / count - meanB * meanB;
  const covariance = sumAB / count - meanA * meanB;

  const numerator = (2 * meanA * meanB + c1) * (2 * covariance + c2);
  const denominator =
    (meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2);

  return denominator === 0 ? 0 : numerator / denominator;
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
  original: Buffer;
  capturedAt: Date;
};

export class ScreenshotCollector {
  private screenshots: CollectedScreenshot[] = [];
  private lastThumb: Buffer | null = null;
  private lastScreenshot: Buffer | null = null;
  private stopped = false;
  private captureQueue: Promise<void> = Promise.resolve();
  private readonly sessionName: string;
  private readonly runDir: string;
  private readonly maxScreenshots: number;

  constructor(
    sessionName: string,
    runDir: string,
    opts?: { maxScreenshots?: number },
  ) {
    this.sessionName = sessionName;
    this.runDir = runDir;
    this.maxScreenshots = opts?.maxScreenshots ?? MAX_SCREENSHOTS;
  }

  captureForToolCall(toolName: string, args: unknown): void {
    const captureKind = getCaptureKind(toolName, args);
    if (this.stopped || !captureKind) {
      return;
    }

    this.enqueueCapture(false);
    if (captureKind === "exec") {
      this.captureQueue = this.captureQueue
        .catch(() => {})
        .then(() => delay(750))
        .then(() => this.captureNow(false));
    }
  }

  async stop(): Promise<Buffer[]> {
    this.stopped = true;

    await this.captureQueue.catch(() => {});
    const finalScreenshot = await this.takeScreenshot();
    if (
      finalScreenshot &&
      (this.screenshots.length === 0 ||
        !(await this.isDuplicateScreenshot(finalScreenshot)))
    ) {
      await this.storeScreenshot(finalScreenshot);
    }

    const resized = await Promise.all(
      this.screenshots.map((screenshot) =>
        imageResize(screenshot.original, SCREENSHOT_SCALE),
      ),
    );

    this.screenshots = [];
    this.lastThumb = null;
    this.lastScreenshot = null;

    return resized;
  }

  private enqueueCapture(forceKeep: boolean): void {
    this.captureQueue = this.captureQueue
      .catch(() => {})
      .then(() => this.captureNow(forceKeep));
  }

  private async captureNow(forceKeep: boolean): Promise<void> {
    const screenshot = await this.takeScreenshot();
    if (!screenshot) {
      return;
    }

    if (!forceKeep && (await this.isDuplicateScreenshot(screenshot))) {
      return;
    }

    await this.storeScreenshot(screenshot);
  }

  private async isDuplicateScreenshot(screenshot: Buffer): Promise<boolean> {
    const thumb = await toThumbnailRaw(screenshot);
    if (this.lastThumb && this.lastScreenshot) {
      const mse = computeMSE(this.lastThumb, thumb);
      if (mse < MSE_THRESHOLD) {
        return true;
      }

      const ssim = await computeSSIM(this.lastScreenshot, screenshot);
      if (ssim >= SSIM_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  private async storeScreenshot(screenshot: Buffer): Promise<void> {
    this.lastThumb = await toThumbnailRaw(screenshot);
    this.lastScreenshot = screenshot;

    this.screenshots.push({ original: screenshot, capturedAt: new Date() });
    while (this.screenshots.length > this.maxScreenshots) {
      this.screenshots.shift();
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

      const pages = contexts.flatMap((context) => context.pages());
      if (pages.length === 0) return null;

      const candidatePages = pages.filter((page) => {
        const url = page.url();
        return url && !url.startsWith("chrome://") && !url.startsWith("about:");
      });

      const page = candidatePages.at(-1) ?? pages.at(-1) ?? null;
      if (!page) return null;

      return (await page.screenshot({
        type: "png",
        fullPage: false,
      })) as Buffer;
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

// ---------------------------------------------------------------------------
// Tool-call detection
// ---------------------------------------------------------------------------

function getCaptureKind(
  toolName: string,
  args: unknown,
): "exec" | "snapshot" | null {
  if (toolName !== "bash" || !args || typeof args !== "object") {
    return null;
  }

  const command =
    typeof (args as { command?: unknown }).command === "string"
      ? (args as { command: string }).command
      : null;
  if (!command) {
    return null;
  }

  const match = command.match(/\blibretto\s+(exec|snapshot)\b/);
  return match?.[1] === "exec" || match?.[1] === "snapshot" ? match[1] : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
