import type { Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import type { LoggerApi } from "../../../shared/logger/index.js";
import { getSessionSnapshotRunDir } from "../context.js";
import {
  snapshot,
  type Snapshot,
} from "../../../shared/snapshot/capture-snapshot.js";
import { waitForPageStable } from "../../../shared/snapshot/wait-for-page-stable.js";
import { librettoCommand } from "../../../shared/package-manager.js";
import {
  resolveSnapshotViewport,
  readSnapshotViewportMetrics,
  shouldForceSnapshotViewport,
  isZeroWidthScreenshotError,
  forceSnapshotViewport,
} from "../../commands/snapshot.js";

const RENDER_SETTLE_TIMEOUT_MS = 10_000;

type SnapshotScreenshot = {
  pngPath: string;
  snapshotRunId: string;
  pageUrl: string;
  title: string;
};

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
  const screenshot = await captureSnapshotScreenshot(
    targetPage,
    session,
    logger,
    pageId,
  );
  const htmlPath = `${getSessionSnapshotRunDir(
    session,
    screenshot.snapshotRunId,
  )}/page.html`;

  // Capture HTML content.
  const htmlContent = await targetPage.content();
  writeFileSync(htmlPath, htmlContent);

  logger.info("screenshot-success", {
    session,
    pageUrl: screenshot.pageUrl,
    title: screenshot.title,
    pngPath: screenshot.pngPath,
    htmlPath,
    snapshotRunId: screenshot.snapshotRunId,
  });

  return {
    ...screenshot,
    htmlPath,
  };
}

export async function handleCompactSnapshot(
  targetPage: Page,
  session: string,
  logger: LoggerApi,
  options: {
    pageId?: string;
    cachedSnapshot?: Snapshot | null;
    useCachedSnapshot?: boolean;
  } = {},
): Promise<{
  mode: "compact";
  pngPath: string;
  snapshot: Snapshot;
}> {
  if (options.useCachedSnapshot) {
    if (!options.cachedSnapshot) {
      throw new Error(
        `No compact snapshot is cached for session "${session}". Run ${librettoCommand(`snapshot --session ${session}`)} first.`,
      );
    }
    const screenshot = await captureSnapshotScreenshot(
      targetPage,
      session,
      logger,
      options.pageId,
    );
    return {
      mode: "compact",
      pngPath: screenshot.pngPath,
      snapshot: options.cachedSnapshot,
    };
  }

  const waitResult = await waitForPageStable(targetPage);
  if (!waitResult.ok) {
    logger.warn("compact-snapshot-stability-wait-incomplete", {
      session,
      pageId: options.pageId,
      diagnostics: waitResult.diagnostics,
    });
  }

  const screenshot = await captureSnapshotScreenshot(
    targetPage,
    session,
    logger,
    options.pageId,
  );

  return {
    mode: "compact",
    pngPath: screenshot.pngPath,
    snapshot: await snapshot(targetPage),
  };
}

async function captureSnapshotScreenshot(
  targetPage: Page,
  session: string,
  logger: LoggerApi,
  pageId?: string,
): Promise<SnapshotScreenshot> {
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

  logger.info("screenshot-captured", {
    session,
    pageUrl,
    title,
    pngPath,
    snapshotRunId,
  });

  return {
    pngPath,
    snapshotRunId,
    pageUrl: pageUrl ?? "",
    title: title ?? "",
  };
}
