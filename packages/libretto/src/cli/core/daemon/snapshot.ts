import type { Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import type { LoggerApi } from "../../../shared/logger/index.js";
import { getSessionSnapshotRunDir } from "../context.js";
import {
  resolveSnapshotViewport,
  readSnapshotViewportMetrics,
  shouldForceSnapshotViewport,
  isZeroWidthScreenshotError,
  forceSnapshotViewport,
} from "../../commands/snapshot.js";

const RENDER_SETTLE_TIMEOUT_MS = 10_000;

export async function handleSnapshot(
  targetPage: Page,
  session: string,
  logger: LoggerApi,
  pageId?: string,
): Promise<{
  pngPath: string;
  htmlPath: string;
  snapshotRunId: string;
  pageUrl: string;
  title: string;
}> {
  const snapshotRunId = `snapshot-${Date.now()}`;
  const snapshotRunDir = getSessionSnapshotRunDir(session, snapshotRunId);
  mkdirSync(snapshotRunDir, { recursive: true });

  // Capture title and URL early, before viewport normalization
  // (matches captureScreenshot ordering).
  let title: string | null = null;
  try {
    title = await targetPage.title();
  } catch (error) {
    logger.warn("screenshot-title-read-failed", { session, pageId, error });
  }

  let pageUrl: string | null = null;
  try {
    pageUrl = targetPage.url();
  } catch (error) {
    logger.warn("screenshot-url-read-failed", { session, pageId, error });
  }

  const pngPath = `${snapshotRunDir}/page.png`;
  const htmlPath = `${snapshotRunDir}/page.html`;

  // Wait for network to settle before capturing.
  await Promise.race([
    targetPage.waitForLoadState("networkidle").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_TIMEOUT_MS)),
  ]);

  // Viewport normalization — uses shared helpers from snapshot.ts.
  const restoreViewport = resolveSnapshotViewport(session, logger);
  const viewportMetrics = await readSnapshotViewportMetrics(targetPage);
  logger.info("screenshot-viewport-metrics", {
    session,
    pageId,
    restoreViewport,
    ...viewportMetrics,
  });
  await forceSnapshotViewport(
    targetPage,
    restoreViewport,
    logger,
    session,
    pageId,
    shouldForceSnapshotViewport(viewportMetrics)
      ? "preflight-invalid-viewport"
      : "preflight-normalize-viewport",
  );

  // Screenshot with zero-width retry.
  try {
    await targetPage.screenshot({ path: pngPath });
  } catch (error) {
    if (!isZeroWidthScreenshotError(error)) {
      throw error;
    }
    await forceSnapshotViewport(
      targetPage,
      restoreViewport,
      logger,
      session,
      pageId,
      "retry-after-zero-width-screenshot-error",
    );
    await targetPage.screenshot({ path: pngPath });
  }

  // Capture HTML content.
  const htmlContent = await targetPage.content();
  writeFileSync(htmlPath, htmlContent);

  logger.info("screenshot-success", {
    session,
    pageUrl,
    title,
    pngPath,
    htmlPath,
    snapshotRunId,
  });

  return {
    pngPath,
    htmlPath,
    snapshotRunId,
    pageUrl: pageUrl ?? "",
    title: title ?? "",
  };
}
