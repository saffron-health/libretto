import { useCallback, useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas-pro";
import { CanvasAsciihedron } from "./components/CanvasAsciihedron";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const SCALE = 2;

const SITE_TITLE =
  "Libretto — The AI Toolkit for Building Robust Web Integrations";
const SITE_DESCRIPTION =
  "An agent skill and token-efficient CLI that inspects live pages, reverse-engineers network requests, and ships production-ready integration workflows.";
const SITE_URL = "libretto.sh";

/**
 * Captures the offscreen container with html2canvas, then composites the
 * asciihedron <canvas> on top (html2canvas silently skips canvas elements).
 */
function useCapturedImage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const el = containerRef.current;
      if (!el) return;

      const htmlLayer = await html2canvas(el, {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        scale: SCALE,
        useCORS: true,
        backgroundColor: null,
      });

      const asciiCanvas = el.querySelector("canvas");
      if (!asciiCanvas) {
        setDataUrl(htmlLayer.toDataURL("image/png"));
        return;
      }

      const containerRect = el.getBoundingClientRect();
      const canvasParent = asciiCanvas.parentElement;
      const wrapperRect = canvasParent
        ? canvasParent.getBoundingClientRect()
        : asciiCanvas.getBoundingClientRect();

      const dx = (wrapperRect.left - containerRect.left) * SCALE;
      const dy = (wrapperRect.top - containerRect.top) * SCALE;
      const dw = wrapperRect.width * SCALE;
      const dh = wrapperRect.height * SCALE;

      const composite = document.createElement("canvas");
      composite.width = OG_WIDTH * SCALE;
      composite.height = OG_HEIGHT * SCALE;
      const ctx = composite.getContext("2d");
      if (!ctx) {
        setDataUrl(htmlLayer.toDataURL("image/png"));
        return;
      }

      ctx.drawImage(htmlLayer, 0, 0);
      ctx.drawImage(asciiCanvas, dx, dy, dw, dh);

      setDataUrl(composite.toDataURL("image/png"));
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return { containerRef, dataUrl };
}

/**
 * LinkedIn link preview card.
 * Real feed card: ~552px wide, image at 1.91:1, 8px border-radius,
 * grey body (#f3f2ef), 1-line truncated title, domain below.
 */
function LinkedInPreview({ src }: { src: string }) {
  const cardWidth = 552;
  const imgHeight = Math.round(cardWidth / 1.91);

  return (
    <div style={{ width: cardWidth }}>
      <p className="mb-3 text-sm font-semibold text-neutral-300">LinkedIn</p>
      <div
        className="overflow-hidden border bg-white"
        style={{ borderRadius: 8, borderColor: "#e0dfdd" }}
      >
        <img
          src={src}
          alt="OG preview"
          className="block w-full object-cover"
          style={{ height: imgHeight }}
        />
        <div
          style={{ height: 3, background: "rgb(0, 140, 120)" }}
        />
        <div className="px-3 py-2.5" style={{ background: "#f3f2ef" }}>
          <p
            className="truncate leading-5"
            style={{
              fontFamily:
                '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              fontSize: 14,
              fontWeight: 600,
              color: "rgba(0,0,0,0.9)",
            }}
          >
            {SITE_TITLE}
          </p>
          <p
            className="mt-0.5 truncate"
            style={{
              fontFamily:
                '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              fontSize: 12,
              color: "rgba(0,0,0,0.6)",
            }}
          >
            {SITE_URL}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * X / Twitter summary_large_image card.
 * Real feed card: ~506px wide, image at 1.91:1, 16px border-radius,
 * white body, domain above title, description below.
 */
function TwitterPreview({ src }: { src: string }) {
  const cardWidth = 506;
  const imgHeight = Math.round(cardWidth / 1.91);

  return (
    <div style={{ width: cardWidth }}>
      <p className="mb-3 text-sm font-semibold text-neutral-300">X / Twitter</p>
      <div
        className="overflow-hidden border"
        style={{ borderRadius: 16, borderColor: "#cfd9de" }}
      >
        <img
          src={src}
          alt="OG preview"
          className="block w-full object-cover"
          style={{ height: imgHeight }}
        />
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: "#cfd9de", background: "#fff" }}
        >
          <p
            className="truncate"
            style={{
              fontFamily:
                '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: 13,
              color: "#536471",
              lineHeight: "16px",
            }}
          >
            {SITE_URL}
          </p>
          <p
            className="mt-0.5 truncate"
            style={{
              fontFamily:
                '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: 15,
              color: "#0f1419",
              lineHeight: "20px",
            }}
          >
            {SITE_TITLE}
          </p>
          <p
            className="mt-0.5 truncate"
            style={{
              fontFamily:
                '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: 15,
              color: "#536471",
              lineHeight: "20px",
            }}
          >
            {SITE_DESCRIPTION}
          </p>
        </div>
      </div>
    </div>
  );
}

export function OgImage() {
  const { containerRef, dataUrl } = useCapturedImage();

  const handleDownload = useCallback(() => {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = "og-image.png";
    link.href = dataUrl;
    link.click();
  }, [dataUrl]);

  return (
    <div className="flex min-h-screen flex-col items-center gap-12 bg-neutral-800 px-8 py-12">
      {/* Offscreen full-size render for capture */}
      <div
        ref={containerRef}
        className="pointer-events-none fixed"
        style={{ left: -9999, top: -9999 }}
      >
        <div
          style={{ width: OG_WIDTH, height: OG_HEIGHT }}
          className="relative overflow-hidden bg-cream"
        >
          <div className="absolute inset-y-0 left-0 z-10 flex w-[540px] flex-col justify-center pl-16 pr-8">
            <h1
              className="font-serif font-extralight tracking-[-0.03em] text-ink"
              style={{ fontSize: 112, lineHeight: 1.0 }}
            >
              Libretto
            </h1>
            <p
              className="mt-8 font-serif font-extralight leading-snug text-muted"
              style={{ fontSize: 46 }}
            >
              The AI Toolkit for Building Robust Web Integrations
            </p>
          </div>

          {/* Asciihedron — much larger, extending well beyond the frame */}
          <div
            className="absolute"
            style={{
              top: "50%",
              left: "60%",
              width: 1400,
              height: 1400,
              transform: "translate(-25%, -50%)",
            }}
          >
            <CanvasAsciihedron
              className="h-full w-full text-ink"
              showAnnotations={false}
              objectScale={1.2}
              spinSpeed={0}
              initialAngle={Math.PI * 0.85}
              baseOpacity={0.28}
            />
          </div>
        </div>
      </div>

      {/* Download button */}
      <button
        type="button"
        onClick={handleDownload}
        disabled={!dataUrl}
        className="cursor-pointer rounded-lg bg-white px-6 py-3 text-sm font-medium text-black shadow-md transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {dataUrl ? `Download as PNG (${OG_WIDTH}×${OG_HEIGHT})` : "Capturing…"}
      </button>

      {/* Social previews */}
      {dataUrl ? (
        <div className="flex flex-wrap justify-center gap-10">
          <LinkedInPreview src={dataUrl} />
          <TwitterPreview src={dataUrl} />
        </div>
      ) : (
        <p className="text-sm text-neutral-400">Rendering OG image…</p>
      )}
    </div>
  );
}
