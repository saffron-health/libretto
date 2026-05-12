import { useEffect, useRef } from "react";

/**
 * Renders the Shadertoy lsKSWR vignette formula to a canvas overlay.
 * Formula: uv *= 1 - uv.yx; vig = pow(uv.x * uv.y * 15, 0.25)
 * Naturally darkens corners far more than edges.
 */
export function CRTVignette({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    function render() {
      const rect = parent!.getBoundingClientRect();
      // Use a lower resolution for performance (the vignette is smooth)
      const scale = 0.25;
      const w = Math.ceil(rect.width * scale);
      const h = Math.ceil(rect.height * scale);
      if (w === 0 || h === 0) return;

      canvas!.width = w;
      canvas!.height = h;
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      const imageData = ctx.createImageData(w, h);
      const data = imageData.data;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let uvx = x / w;
          let uvy = y / h;

          // uv *= 1.0 - uv.yx
          const nx = uvx * (1 - uvy);
          const ny = uvy * (1 - uvx);

          const vig = Math.pow(nx * ny * 15, 0.25);
          // Invert: we want darkness where vig is low
          const darkness = Math.max(0, Math.min(1, 1 - vig));

          const idx = (y * w + x) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = Math.round(darkness * 200); // max alpha ~0.78
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    render();
    const ro = new ResizeObserver(render);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 z-[22] h-full w-full ${className}`}
      style={{ imageRendering: "auto" }}
    />
  );
}
