import { CanvasAsciihedron } from "./components/CanvasAsciihedron";

export function IcosahedronDebug() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020305] text-white">
      <CanvasAsciihedron className="h-[800px] w-[800px] max-h-[92vw] max-w-[92vw] text-white" />
    </div>
  );
}
