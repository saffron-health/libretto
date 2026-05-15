import type { Page, Download } from "playwright";
import type { MinimalLogger } from "../logger/logger.js";

export type DownloadResult = {
  /** The raw file contents. */
  buffer: Buffer;
  /** The filename suggested by the server (Content-Disposition header or URL). */
  filename: string;
};

export type DownloadViaClickOptions = {
  logger?: MinimalLogger;
  /** Timeout in milliseconds for waiting on the download event. Defaults to 30 000. */
  timeout?: number;
};

/**
 * Triggers a file download by clicking a DOM element and intercepts the
 * resulting download using Playwright's download event.
 *
 * The download promise is registered **before** the click so the event is
 * never missed.
 */
export async function downloadViaClick(
  page: Page,
  selector: string,
  options?: DownloadViaClickOptions,
): Promise<DownloadResult> {
  const { logger, timeout = 30_000 } = options ?? {};

  const startTime = Date.now();

  // 1. Register the download listener BEFORE clicking
  const downloadPromise = page.waitForEvent("download", { timeout });

  // 2. Click the element that triggers the download
  await page.locator(selector).click();

  // 3. Await the download event
  const download: Download = await downloadPromise;

  // 4. Get the suggested filename
  const filename = download.suggestedFilename();

  // 5. Read the downloaded file into a buffer
  const readStream = await download.createReadStream();
  if (!readStream) {
    throw new Error(
      `Download stream unavailable for "${filename}". The browser may have been closed before the download completed.`,
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of readStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);

  const duration = Date.now() - startTime;

  logger?.info("download:click", {
    selector,
    filename,
    size: buffer.length,
    duration,
  });

  return { buffer, filename };
}

