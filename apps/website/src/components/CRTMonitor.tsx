import type { PropsWithChildren } from "react";
import { CRTShader } from "./CRTShader.js";

export function CRTMonitor({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`crt-monitor ${className}`}>
      {children}
      <CRTShader />
    </div>
  );
}
