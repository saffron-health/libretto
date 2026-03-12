import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, Download } from "playwright";
import type { MinimalLogger } from "../../shared/logger/logger.js";

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

export type SaveDownloadOptions = DownloadViaClickOptions & {
	/** Absolute or relative path to save the file to. When omitted the suggested filename is used in the current working directory. */
	savePath?: string;
};

/**
 * Convenience wrapper around {@link downloadViaClick} that also writes the
 * downloaded file to disk.
 */
export async function downloadAndSave(
	page: Page,
	selector: string,
	options?: SaveDownloadOptions,
): Promise<DownloadResult & { savedTo: string }> {
	const { savePath, ...downloadOpts } = options ?? {};
	const { buffer, filename } = await downloadViaClick(page, selector, downloadOpts);

	const dest = resolve(savePath ?? filename);
	await writeFile(dest, buffer);

	options?.logger?.info("download:saved", {
		filename,
		savedTo: dest,
		size: buffer.length,
	});

	return { buffer, filename, savedTo: dest };
}
