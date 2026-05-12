import type { PropsWithChildren } from "react";
import { CRTVignette } from "./CRTVignette.js";

export function CRTMonitor({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`crt-monitor ${className}`}>
      {children}
      <CRTVignette />
    </div>
  );
}
