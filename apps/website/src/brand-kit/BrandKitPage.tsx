import { useRef, useState } from "react";
import type * as React from "react";
import { AsciiLogo } from "../components/AsciiLogo.js";
import { CanvasAsciihedron } from "../components/CanvasAsciihedron.js";
import { Kicker } from "../components/Kicker.js";
import { Panel } from "../components/Panel.js";
import { SectionDivider } from "../components/SectionDivider.js";
import { Text } from "../components/Text.js";
import { SolidIcosahedron } from "./SolidIcosahedron.js";
import { SOLID_ICOSAHEDRON_ROTATION } from "./solidIcosahedronGeometry.mjs";
import type { SolidIcosahedronRotation } from "./solidIcosahedronGeometry.mjs";

type BrandTab = "logos" | "asciihedron" | "wordmark" | "socials";
type ThemeMode = "dark" | "light";
type RotationAxis = keyof SolidIcosahedronRotation;

type CSSVarStyle = React.CSSProperties & Record<`--${string}`, string>;

interface DownloadAsset {
  label: string;
  detail: string;
  href: string;
  download: string;
}

type CanvasExportFormat = "png" | "svg" | "webp";

interface CanvasDownloadAsset {
  label: string;
  detail: string;
  download: string;
  format: CanvasExportFormat;
}

interface SocialAsset extends DownloadAsset {
  width: number;
  height: number;
}

interface SocialPlatform {
  id: string;
  label: string;
  accountHref?: string;
  accountLabel?: string;
  note?: string;
  profile: SocialAsset;
  banner: SocialAsset;
}

const lightModeAmber = "color(display-p3 0.937 0.729 0.199)";
const lightModeAmberFallback = "#f9b700";

const themeColors: Record<ThemeMode, CSSVarStyle> = {
  dark: {
    "--color-bg": "#111111",
    "--color-panel": "#171917",
    "--color-panel-hi": "#202320",
    "--color-rule": "#262a26",
    "--color-ink": "#ebeeeb",
    "--color-muted": "#abb7ab",
    "--color-faint": "#596359",
    "--color-accent": "#12ce41",
    "--color-accent-bright": "#12ce41",
    "--color-accent-dim": "#12ce41",
    "--color-amber": "#f0cf5a",
    "--color-amber-bright": "#f0cf5a",
    "--color-asciihedron-monochrome": "#ffffff",
  },
  light: {
    "--color-bg": "#f3f5f1",
    "--color-panel": "#ffffff",
    "--color-panel-hi": "#e8ede6",
    "--color-rule": "#cdd6ca",
    "--color-ink": "#101410",
    "--color-muted": "#4f5d4f",
    "--color-faint": "#7a887a",
    "--color-accent": "#0c9f32",
    "--color-accent-bright": "#0c9f32",
    "--color-accent-dim": "#0c9f32",
    "--color-amber": lightModeAmber,
    "--color-amber-bright": lightModeAmber,
    "--color-asciihedron-monochrome": "#000000",
  },
};

const tabs: { id: BrandTab; label: string }[] = [
  { id: "logos", label: "Logos" },
  { id: "asciihedron", label: "Asciihedron" },
  { id: "wordmark", label: "Wordmark" },
  { id: "socials", label: "Socials" },
];

const rotationAxes: { id: RotationAxis; label: string }[] = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
  { id: "z", label: "Z" },
];

const logoStillAssets: DownloadAsset[] = [
  {
    label: "SVG",
    detail: "Vector, transparent",
    href: "/brand-kit/logos/libretto-icosahedron-yellow.svg",
    download: "libretto-icosahedron-yellow.svg",
  },
  {
    label: "PNG 1024",
    detail: "Primary raster",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-1024.png",
    download: "libretto-icosahedron-yellow-1024.png",
  },
  {
    label: "PNG 512",
    detail: "App/site logo",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-512.png",
    download: "libretto-icosahedron-yellow-512.png",
  },
  {
    label: "PNG 256",
    detail: "Profile/avatar",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-256.png",
    download: "libretto-icosahedron-yellow-256.png",
  },
  {
    label: "PNG 128",
    detail: "Small UI mark",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-128.png",
    download: "libretto-icosahedron-yellow-128.png",
  },
  {
    label: "PNG 64",
    detail: "Icon slot",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-64.png",
    download: "libretto-icosahedron-yellow-64.png",
  },
  {
    label: "PNG 32",
    detail: "Favicon-sized",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-32.png",
    download: "libretto-icosahedron-yellow-32.png",
  },
  {
    label: "WebP",
    detail: "Compressed web still",
    href: "/brand-kit/logos/libretto-icosahedron-yellow-1024.webp",
    download: "libretto-icosahedron-yellow-1024.webp",
  },
];

const logoMotionAssets: DownloadAsset[] = [
  {
    label: "MP4",
    detail: "Looping logo animation",
    href: "/brand-kit/animation/libretto-icosahedron-logo-loop.mp4",
    download: "libretto-icosahedron-logo-loop.mp4",
  },
  {
    label: "WebM",
    detail: "Looping web video",
    href: "/brand-kit/animation/libretto-icosahedron-logo-loop.webm",
    download: "libretto-icosahedron-logo-loop.webm",
  },
  {
    label: "WebP",
    detail: "Animated web image",
    href: "/brand-kit/animation/libretto-icosahedron-logo-loop.webp",
    download: "libretto-icosahedron-logo-loop.webp",
  },
];

const asciihedronCurrentStillAssets: CanvasDownloadAsset[] = [
  {
    label: "PNG",
    detail: "Current preview raster",
    download: "libretto-asciihedron-still.png",
    format: "png",
  },
  {
    label: "SVG",
    detail: "Current preview SVG wrapper",
    download: "libretto-asciihedron-still.svg",
    format: "svg",
  },
  {
    label: "WebP",
    detail: "Current preview compressed",
    download: "libretto-asciihedron-still.webp",
    format: "webp",
  },
];

const asciihedronMotionAssets: DownloadAsset[] = [
  {
    label: "MP4",
    detail: "17.46s seamless loop",
    href: "/brand-kit/animation/libretto-asciihedron-loop.mp4",
    download: "libretto-asciihedron-loop.mp4",
  },
  {
    label: "WebM",
    detail: "17.46s seamless loop",
    href: "/brand-kit/animation/libretto-asciihedron-loop.webm",
    download: "libretto-asciihedron-loop.webm",
  },
  {
    label: "WebP",
    detail: "Animated web preview",
    href: "/brand-kit/animation/libretto-asciihedron-loop.webp",
    download: "libretto-asciihedron-loop.webp",
  },
];

const wordmarkAssets: DownloadAsset[] = [
  {
    label: "SVG",
    detail: "ASCII wordmark vector",
    href: "/brand-kit/wordmark/libretto-ascii-wordmark.svg",
    download: "libretto-ascii-wordmark.svg",
  },
  {
    label: "PNG",
    detail: "Transparent raster",
    href: "/brand-kit/wordmark/libretto-ascii-wordmark.png",
    download: "libretto-ascii-wordmark.png",
  },
  {
    label: "WebP",
    detail: "Compressed web still",
    href: "/brand-kit/wordmark/libretto-ascii-wordmark.webp",
    download: "libretto-ascii-wordmark.webp",
  },
];

const fontAssets: DownloadAsset[] = [
  {
    label: "Fraunces",
    detail: "Google Fonts",
    href: "https://fonts.google.com/specimen/Fraunces",
    download: "",
  },
  {
    label: "Commit Mono",
    detail: "Local WOFF2",
    href: "/fonts/CommitMono-VF.woff2",
    download: "CommitMono-VF.woff2",
  },
];

const socialPlatforms: SocialPlatform[] = [
  {
    id: "x",
    label: "X",
    accountHref: "https://x.com/libretto_sh",
    accountLabel: "@libretto_sh",
    profile: {
      label: "X profile",
      detail: "400 x 400 PNG",
      href: "/brand-kit/socials/x-profile.png",
      download: "libretto-x-profile.png",
      width: 400,
      height: 400,
    },
    banner: {
      label: "X banner",
      detail: "1500 x 500 PNG",
      href: "/brand-kit/socials/x-banner.png",
      download: "libretto-x-banner.png",
      width: 1500,
      height: 500,
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    profile: {
      label: "Reddit icon",
      detail: "256 x 256 PNG",
      href: "/brand-kit/socials/reddit-profile.png",
      download: "libretto-reddit-icon.png",
      width: 256,
      height: 256,
    },
    banner: {
      label: "Reddit banner",
      detail: "1080 x 128 PNG",
      href: "/brand-kit/socials/reddit-banner.png",
      download: "libretto-reddit-banner.png",
      width: 1080,
      height: 128,
    },
  },
  {
    id: "instagram",
    label: "Instagram",
    note: "Instagram does not have an account banner slot; use the square tile for launch posts, pinned grids, or story covers.",
    profile: {
      label: "Instagram profile",
      detail: "320 x 320 PNG",
      href: "/brand-kit/socials/instagram-profile.png",
      download: "libretto-instagram-profile.png",
      width: 320,
      height: 320,
    },
    banner: {
      label: "Instagram tile",
      detail: "1080 x 1080 PNG",
      href: "/brand-kit/socials/instagram-banner.png",
      download: "libretto-instagram-tile.png",
      width: 1080,
      height: 1080,
    },
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    profile: {
      label: "LinkedIn logo",
      detail: "400 x 400 PNG",
      href: "/brand-kit/socials/linkedin-profile.png",
      download: "libretto-linkedin-logo.png",
      width: 400,
      height: 400,
    },
    banner: {
      label: "LinkedIn cover",
      detail: "4200 x 700 PNG",
      href: "/brand-kit/socials/linkedin-banner.png",
      download: "libretto-linkedin-cover.png",
      width: 4200,
      height: 700,
    },
  },
];

const ogImageAsset: SocialAsset = {
  label: "OG image",
  detail: "1200 x 630 PNG",
  href: "/og-image.png",
  download: "libretto-og-browser-agents.png",
  width: 1200,
  height: 630,
};

function ThemeButton({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-rule bg-panel-hi p-1">
      {(["dark", "light"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-9 rounded-md px-4 font-mono text-xs font-medium uppercase transition-colors ${
            mode === option
              ? "bg-accent text-bg"
              : "text-muted hover:bg-panel hover:text-ink"
          }`}
          aria-pressed={mode === option}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function LightYellowPicker({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputValue = value.startsWith("#") ? value : lightModeAmberFallback;

  return (
    <label
      className={`inline-flex h-[46px] items-center gap-3 rounded-lg border border-rule bg-panel-hi px-3 ${
        disabled ? "opacity-45" : ""
      }`}
    >
      <span className="font-mono text-xs font-medium uppercase text-muted">
        Light yellow
      </span>
      <input
        type="color"
        value={inputValue}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
        aria-label="Light mode yellow"
      />
      <span className="max-w-[220px] truncate font-mono text-xs text-faint" title={value}>
        {value}
      </span>
    </label>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      className={`h-11 rounded-md px-4 font-mono text-xs font-semibold uppercase transition-colors ${
        active
          ? "bg-accent text-bg"
          : "text-muted hover:bg-panel-hi hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function StillToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-rule bg-panel-hi px-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--color-accent)]"
      />
      <span className="font-mono text-xs font-medium uppercase text-ink">
        Still
      </span>
    </label>
  );
}

function MonochromeToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-rule bg-panel-hi px-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--color-accent)]"
      />
      <span className="font-mono text-xs font-medium uppercase text-ink">
        Monochrome
      </span>
    </label>
  );
}

function DownloadGrid({ assets }: { assets: DownloadAsset[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <DownloadTile
          key={`${asset.href}-${asset.label}`}
          asset={asset}
        />
      ))}
    </div>
  );
}

function DownloadTile({ asset }: { asset: DownloadAsset }) {
  const [status, setStatus] = useState<"idle" | "downloading" | "failed">(
    "idle",
  );
  const content = (
    <>
      <span className="block font-mono text-sm font-semibold text-ink">
        {status === "downloading" ? "Downloading..." : asset.label}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted">
        {status === "failed" ? "Download failed. Opened source instead." : asset.detail}
      </span>
    </>
  );

  async function handleDownload() {
    if (!asset.download) {
      return;
    }

    setStatus("downloading");
    try {
      const response = await fetch(asset.href);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${asset.href}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = asset.download;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("idle");
    } catch {
      setStatus("failed");
      window.open(asset.href, "_blank", "noopener,noreferrer");
    }
  }

  if (!asset.download) {
    return (
      <a
        href={asset.href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-rule bg-panel-hi p-4 no-underline transition-colors hover:border-accent/50 hover:bg-panel"
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="rounded-md border border-rule bg-panel-hi p-4 text-left transition-colors hover:border-accent/50 hover:bg-panel"
    >
      {content}
    </button>
  );
}

function downloadBlob(blob: Blob, download: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: CanvasExportFormat,
) {
  if (format === "svg") {
    const dataUrl = canvas.toDataURL("image/png");
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`,
      "<title>Libretto asciihedron current preview</title>",
      `<image href="${dataUrl}" width="${canvas.width}" height="${canvas.height}" />`,
      "</svg>",
    ].join("\n");
    return new Blob([`${svg}\n`], { type: "image/svg+xml" });
  }

  const mimeType = format === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType);
  });
  if (!blob) {
    throw new Error(`Unable to export canvas as ${mimeType}.`);
  }
  return blob;
}

function CanvasDownloadGrid({
  assets,
  canvasRef,
}: {
  assets: CanvasDownloadAsset[];
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <CanvasDownloadTile
          key={asset.download}
          asset={asset}
          canvasRef={canvasRef}
        />
      ))}
    </div>
  );
}

function CanvasDownloadTile({
  asset,
  canvasRef,
}: {
  asset: CanvasDownloadAsset;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const [status, setStatus] = useState<"idle" | "downloading" | "failed">(
    "idle",
  );

  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) {
      setStatus("failed");
      return;
    }

    setStatus("downloading");
    try {
      const blob = await canvasToBlob(canvas, asset.format);
      downloadBlob(blob, asset.download);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="rounded-md border border-rule bg-panel-hi p-4 text-left transition-colors hover:border-accent/50 hover:bg-panel"
    >
      <span className="block font-mono text-sm font-semibold text-ink">
        {status === "downloading" ? "Downloading..." : asset.label}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted">
        {status === "failed" ? "Could not export current canvas." : asset.detail}
      </span>
    </button>
  );
}

function RotationControls({
  onChange,
  rotation,
}: {
  onChange: (rotation: SolidIcosahedronRotation) => void;
  rotation: SolidIcosahedronRotation;
}) {
  function updateAxis(axis: RotationAxis, value: number) {
    onChange({
      ...rotation,
      [axis]: Number.isFinite(value) ? value : 0,
    });
  }

  return (
    <div className="rounded-lg border border-rule bg-panel p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold uppercase text-muted">
          Rotation
        </span>
        <button
          type="button"
          onClick={() => onChange({ ...SOLID_ICOSAHEDRON_ROTATION })}
          className="h-8 rounded-md border border-rule bg-panel-hi px-3 font-mono text-xs font-medium uppercase text-muted transition-colors hover:border-accent/50 hover:text-ink"
        >
          Reset {SOLID_ICOSAHEDRON_ROTATION.x} / {SOLID_ICOSAHEDRON_ROTATION.y} /{" "}
          {SOLID_ICOSAHEDRON_ROTATION.z}
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {rotationAxes.map((axis) => (
          <label
            key={axis.id}
            className="grid gap-2 rounded-md border border-rule bg-panel-hi p-3"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs font-semibold uppercase text-ink">
                {axis.label}
              </span>
              <input
                type="number"
                min={-180}
                max={180}
                step={1}
                value={rotation[axis.id]}
                onChange={(event) => updateAxis(axis.id, event.target.valueAsNumber)}
                className="h-8 w-20 rounded-md border border-rule bg-bg px-2 text-right font-mono text-xs text-ink outline-none focus:border-accent"
                aria-label={`${axis.label} rotation degrees`}
              />
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation[axis.id]}
              onChange={(event) => updateAxis(axis.id, event.target.valueAsNumber)}
              className="w-full accent-[var(--color-accent)]"
              aria-label={`${axis.label} rotation slider`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[560px] items-center justify-center overflow-hidden rounded-lg border border-rule bg-bg p-8">
      {children}
    </div>
  );
}

function LogosTab({
  onRotationChange,
  rotation,
}: {
  onRotationChange: (rotation: SolidIcosahedronRotation) => void;
  rotation: SolidIcosahedronRotation;
}) {
  const [showStill, setShowStill] = useState(true);

  return (
    <BrandTabPanel
      kicker="Primary mark"
      title="Solid gold icosahedron logo"
      description={`Use this as the identity anchor. The current preview pose is x=${rotation.x}, y=${rotation.y}, z=${rotation.z}.`}
      controls={
        <RotationControls
          rotation={rotation}
          onChange={onRotationChange}
        />
      }
      still={showStill}
      onStillChange={setShowStill}
      preview={
        <PreviewShell>
          <div className="relative flex items-center justify-center">
            <div className="absolute h-[320px] w-[320px] rounded-full bg-amber/20 blur-2xl" />
            <SolidIcosahedron
              autoRotate={!showStill}
              className="relative z-10 h-[420px] w-[420px]"
              rotation={rotation}
              style={{
                filter:
                  "drop-shadow(0 0 20px color-mix(in oklch, var(--color-amber-bright) 55%, transparent)) drop-shadow(0 0 64px color-mix(in oklch, var(--color-amber-bright) 24%, transparent))",
              }}
            />
          </div>
        </PreviewShell>
      }
      downloads={
        showStill ? (
          <DownloadGrid assets={logoStillAssets} />
        ) : (
          <DownloadGrid assets={logoMotionAssets} />
        )
      }
    />
  );
}

function AsciihedronTab({
  onRotationChange,
  rotation,
}: {
  onRotationChange: (rotation: SolidIcosahedronRotation) => void;
  rotation: SolidIcosahedronRotation;
}) {
  const [showStill, setShowStill] = useState(true);
  const [monochrome, setMonochrome] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const asciihedronClassName = `h-[1600px] w-[1600px] min-h-[1200px] min-w-[1200px] max-h-[180vw] max-w-[180vw] shrink-0 ${
    monochrome ? "text-[var(--color-asciihedron-monochrome)]" : "text-ink"
  }`;
  const asciihedronOpacity = monochrome ? 1 : 0.11;

  return (
    <BrandTabPanel
      kicker="Technical texture"
      title="Asciihedron"
      description={`Use as a background motif, process texture, or motion layer behind the mark. The current preview pose is x=${rotation.x}, y=${rotation.y}, z=${rotation.z}.`}
      controls={
        <RotationControls
          rotation={rotation}
          onChange={onRotationChange}
        />
      }
      still={showStill}
      onStillChange={setShowStill}
      actions={
        <MonochromeToggle
          checked={monochrome}
          onChange={setMonochrome}
        />
      }
      preview={
        <PreviewShell>
          {showStill ? (
            <CanvasAsciihedron
              canvasRef={previewCanvasRef}
              className={`pointer-events-none ${asciihedronClassName}`}
              flatOpacity={monochrome}
              showAnnotations={false}
              objectScale={1.2}
              rotation={rotation}
              spinSpeed={0}
              baseOpacity={asciihedronOpacity}
            />
          ) : (
            <div>
              <CanvasAsciihedron
                canvasRef={previewCanvasRef}
                className={asciihedronClassName}
                flatOpacity={monochrome}
                showAnnotations={false}
                objectScale={1.2}
                rotation={rotation}
                baseOpacity={asciihedronOpacity}
              />
            </div>
          )}
        </PreviewShell>
      }
      downloads={
        showStill ? (
          <CanvasDownloadGrid
            assets={asciihedronCurrentStillAssets}
            canvasRef={previewCanvasRef}
          />
        ) : (
          <DownloadGrid assets={asciihedronMotionAssets} />
        )
      }
    />
  );
}

function WordmarkTab() {
  return (
    <BrandTabPanel
      kicker="ASCII wordmark"
      title="Libretto wordmark"
      description="Use the ASCII render for terminal-native moments, video title cards, and technical overlays."
      preview={
        <PreviewShell>
          <div className="w-full overflow-hidden px-4">
            <AsciiLogo className="text-[8px] lg:text-[12px]" />
          </div>
        </PreviewShell>
      }
      downloads={
        <div className="grid gap-6">
          <div>
            <Text as="h3" size="md" className="mb-3 font-medium text-ink">
              Wordmark exports
            </Text>
            <DownloadGrid assets={wordmarkAssets} />
          </div>
          <div>
            <Text as="h3" size="md" className="mb-3 font-medium text-ink">
              Fonts
            </Text>
            <DownloadGrid assets={fontAssets} />
          </div>
        </div>
      }
    />
  );
}

function SocialsTab() {
  return (
    <BrandTabPanel
      kicker="Account kit"
      title="Socials"
      description="Profile images use a smaller centered mark so the logo keeps breathing room inside circular crops. Banners keep the primary content near the center for responsive cropping."
      preview={
        <div className="grid gap-4 xl:grid-cols-2">
          {socialPlatforms.map((platform) => (
            <SocialPlatformPreview key={platform.id} platform={platform} />
          ))}
          <OgImagePreview />
        </div>
      }
      downloads={
        <div className="grid gap-7">
          {socialPlatforms.map((platform) => (
            <div key={platform.id}>
              <Text as="h3" size="md" className="mb-3 font-medium text-ink">
                {platform.label}
              </Text>
              <DownloadGrid assets={[platform.profile, platform.banner]} />
            </div>
          ))}
          <div>
            <Text as="h3" size="md" className="mb-3 font-medium text-ink">
              OG image
            </Text>
            <DownloadGrid assets={[ogImageAsset]} />
          </div>
        </div>
      }
    />
  );
}

function SocialPlatformPreview({ platform }: { platform: SocialPlatform }) {
  return (
    <div className="rounded-lg border border-rule bg-bg p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Text as="h3" size="md" className="font-medium text-ink">
            {platform.label}
          </Text>
          {platform.accountHref && platform.accountLabel ? (
            <a
              href={platform.accountHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block font-mono text-xs text-accent no-underline hover:text-accent-bright"
            >
              {platform.accountLabel}
            </a>
          ) : null}
        </div>
        <span className="font-mono text-xs uppercase text-faint">
          {platform.profile.width} x {platform.profile.height} /{" "}
          {platform.banner.width} x {platform.banner.height}
        </span>
      </div>
      <SocialPreviewSurface platform={platform} />
      {platform.note ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {platform.note}
        </p>
      ) : null}
    </div>
  );
}

function SocialPreviewSurface({ platform }: { platform: SocialPlatform }) {
  if (platform.id === "x") {
    return <XPreview platform={platform} />;
  }
  if (platform.id === "reddit") {
    return <RedditPreview platform={platform} />;
  }
  if (platform.id === "instagram") {
    return <InstagramPreview platform={platform} />;
  }
  return <LinkedInPreview platform={platform} />;
}

function XPreview({ platform }: { platform: SocialPlatform }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#eff3f4] bg-white text-[#0f1419]">
      <div className="flex h-12 items-center gap-4 border-b border-[#eff3f4] px-4">
        <span className="text-lg">←</span>
        <div>
          <p className="text-sm font-bold leading-tight">
            Libretto <span className="text-[#1d9bf0]">●</span>
          </p>
          <p className="text-xs leading-tight text-[#536471]">0 posts</p>
        </div>
      </div>
      <div className="relative">
        <img
          src={platform.banner.href}
          alt="X banner preview"
          className="h-auto w-full object-cover"
          style={{ aspectRatio: "3 / 1" }}
        />
        <img
          src={platform.profile.href}
          alt="X profile preview"
          className="absolute left-4 top-full size-24 -translate-y-1/2 rounded-full border-4 border-white object-cover"
        />
      </div>
      <div className="px-4 pb-4 pt-16">
        <div className="flex justify-end">
          <span className="rounded-full bg-[#0f1419] px-5 py-2 text-sm font-bold text-white">
            Follow
          </span>
        </div>
        <p className="mt-1 text-xl font-extrabold leading-tight">
          Libretto <span className="text-[#1d9bf0]">●</span>
        </p>
        <p className="text-sm text-[#536471]">@libretto_sh</p>
        <p className="mt-3 text-sm leading-snug">
          Open-source CLI for turning website workflows into fast, reusable scripts.
        </p>
        <div className="mt-5 grid grid-cols-3 border-b border-[#eff3f4] text-center text-sm font-semibold text-[#536471]">
          <span className="border-b-4 border-[#1d9bf0] pb-3 text-[#0f1419]">Posts</span>
          <span className="pb-3">Replies</span>
          <span className="pb-3">Media</span>
        </div>
      </div>
    </div>
  );
}

function RedditPreview({ platform }: { platform: SocialPlatform }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#edeff1] bg-white text-[#1c1c1c]">
      <div className="flex h-10 items-center justify-between border-b border-[#edeff1] px-4 text-sm">
        <span className="font-bold text-[#ff4500]">reddit</span>
        <span className="rounded-full bg-[#ff4500] px-4 py-1.5 text-xs font-bold text-white">
          Join
        </span>
      </div>
      <img
        src={platform.banner.href}
        alt="Reddit banner preview"
        className="h-auto w-full object-cover"
        style={{ aspectRatio: `${platform.banner.width} / ${platform.banner.height}` }}
      />
      <div className="px-4 pb-4">
        <div className="-mt-7 flex items-end gap-3">
          <img
            src={platform.profile.href}
            alt="Reddit icon preview"
            className="size-16 rounded-full border-4 border-white object-cover"
          />
          <div className="pb-1">
            <p className="text-lg font-bold">r/libretto</p>
            <p className="text-xs text-[#576f76]">1 member · 4 online</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-snug text-[#1c1c1c]">
          Browser automation that holds still.
        </p>
        <div className="mt-4 flex gap-2 border-t border-[#edeff1] pt-3 text-xs font-bold uppercase text-[#576f76]">
          <span className="rounded-full bg-[#edeff1] px-3 py-1.5 text-[#1c1c1c]">Posts</span>
          <span className="px-3 py-1.5">About</span>
          <span className="px-3 py-1.5">Wiki</span>
        </div>
      </div>
    </div>
  );
}

function InstagramPreview({ platform }: { platform: SocialPlatform }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#dbdbdb] bg-white p-5 text-[#262626]">
      <div className="flex items-start gap-5">
        <img
          src={platform.profile.href}
          alt="Instagram profile preview"
          className="size-24 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg leading-tight">libretto_sh</p>
            <span className="rounded-md bg-[#efefef] px-3 py-1 text-xs font-semibold">
              Follow
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-sm">
            <span><strong>0</strong> posts</span>
            <span><strong>1</strong> follower</span>
            <span><strong>2</strong> following</span>
          </div>
          <p className="mt-3 text-sm font-semibold">Libretto</p>
          <p className="text-sm leading-snug">Turn website workflows into reliable APIs.</p>
        </div>
      </div>
      <div className="mt-5 flex gap-4">
        {["CLI", "APIs", "Demos"].map((label) => (
          <div key={label} className="text-center">
            <div className="mx-auto size-14 rounded-full border border-[#dbdbdb] bg-[#fafafa]" />
            <p className="mt-1 text-[11px]">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-1 border-t border-[#dbdbdb] pt-4">
        <img
          src={platform.banner.href}
          alt="Instagram tile preview"
          className="aspect-square object-cover"
        />
        <div className="aspect-square bg-[#171917]" />
        <div className="aspect-square bg-[#202320]" />
      </div>
    </div>
  );
}

function LinkedInPreview({ platform }: { platform: SocialPlatform }) {
  return (
    <div className="overflow-hidden rounded-md bg-[#f4f2ee] p-4 text-[#000000e6]">
      <div className="mb-3 flex h-9 items-center justify-between rounded-sm bg-white px-4 text-sm shadow-sm">
        <span className="font-bold text-[#0a66c2]">LinkedIn</span>
        <span className="rounded-full border border-[#0a66c2] px-3 py-1 text-xs font-semibold text-[#0a66c2]">
          Sign in
        </span>
      </div>
      <div className="overflow-hidden rounded-md bg-white shadow-sm">
        <img
          src={platform.banner.href}
          alt="LinkedIn cover preview"
          className="h-auto w-full object-cover"
          style={{ aspectRatio: "6 / 1" }}
        />
        <div className="px-6 pb-5">
          <img
            src={platform.profile.href}
            alt="LinkedIn logo preview"
            className="-mt-10 size-24 border-4 border-white bg-white object-cover shadow-md"
          />
          <p className="mt-3 text-2xl font-semibold leading-tight">Libretto</p>
          <p className="text-sm text-[#00000099]">Software Development · San Francisco, CA</p>
          <p className="mt-1 text-sm text-[#00000099]">Browser automation APIs for coding agents</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="rounded-full bg-[#0a66c2] px-4 py-1.5 text-sm font-semibold text-white">
              Follow
            </span>
            <span className="rounded-full border border-[#0a66c2] px-4 py-1.5 text-sm font-semibold text-[#0a66c2]">
              Visit website
            </span>
          </div>
        </div>
        <div className="flex gap-10 border-t border-[#e0dfdc] px-6 py-3 text-sm font-semibold text-[#00000099]">
          <span className="text-[#000000e6]">Overview</span>
          <span>Posts</span>
          <span>Jobs</span>
        </div>
      </div>
    </div>
  );
}

function OgImagePreview() {
  return (
    <div className="rounded-lg border border-rule bg-bg p-5 xl:col-span-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Text as="h3" size="md" className="font-medium text-ink">
          OG image
        </Text>
        <span className="font-mono text-xs uppercase text-faint">
          {ogImageAsset.width} x {ogImageAsset.height}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-rule bg-panel-hi p-3">
        <img
          src={ogImageAsset.href}
          alt="Don't make browser agents do a script's job OG image"
          className="w-full object-contain"
          style={{
            aspectRatio: `${ogImageAsset.width} / ${ogImageAsset.height}`,
          }}
        />
      </div>
    </div>
  );
}

function BrandTabPanel({
  actions,
  controls,
  description,
  downloads,
  kicker,
  onStillChange,
  preview,
  still,
  title,
}: {
  actions?: React.ReactNode;
  controls?: React.ReactNode;
  description: string;
  downloads: React.ReactNode;
  kicker: string;
  onStillChange?: (still: boolean) => void;
  preview: React.ReactNode;
  still?: boolean;
  title: string;
}) {
  return (
    <section className="grid gap-8 py-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Kicker className="mb-3">{kicker}</Kicker>
          <Text
            as="h2"
            size="5xl"
            style="serif"
            className="crt-glow text-ink"
            htmlStyle={{
              fontWeight: 300,
              fontSize: "clamp(36px, 5vw, 64px)",
              lineHeight: 1.02,
            }}
          >
            {title}
          </Text>
          <Text as="p" size="md" className="mt-4 max-w-[720px] leading-relaxed text-muted">
            {description}
          </Text>
          {controls ? <div className="mt-5 max-w-[920px]">{controls}</div> : null}
        </div>
        {actions || (typeof still === "boolean" && onStillChange) ? (
          <div className="flex flex-wrap items-center gap-3">
            {typeof still === "boolean" && onStillChange ? (
              <StillToggle checked={still} onChange={onStillChange} />
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>

      {preview}

      <Panel>
        <Text as="h3" size="md" className="mb-4 font-medium text-ink">
          Downloads
        </Text>
        {downloads}
      </Panel>
    </section>
  );
}

export function BrandKitPage() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [activeTab, setActiveTab] = useState<BrandTab>("logos");
  const [lightYellow, setLightYellow] = useState(lightModeAmber);
  const [rotation, setRotation] = useState<SolidIcosahedronRotation>({
    ...SOLID_ICOSAHEDRON_ROTATION,
  });
  const themeStyle: CSSVarStyle =
    mode === "light"
      ? {
          ...themeColors.light,
          "--color-amber": lightYellow,
          "--color-amber-bright": lightYellow,
        }
      : themeColors.dark;

  return (
    <main className="min-h-screen bg-bg text-ink" style={themeStyle}>
      <div className="mx-auto flex min-h-screen max-w-[1320px] flex-col px-6 py-10 md:px-10">
        <header className="flex flex-col gap-8 pb-10 md:flex-row md:items-end md:justify-between">
          <div>
            <Kicker className="mb-4">Libretto producer brand kit</Kicker>
            <Text
              as="h1"
              size="5xl"
              style="serif"
              className="crt-glow max-w-[820px] text-ink [text-wrap:balance]"
              htmlStyle={{
                fontWeight: 300,
                fontSize: "clamp(44px, 7vw, 88px)",
                lineHeight: 1,
              }}
            >
              Production-ready brand assets.
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeButton mode={mode} onChange={setMode} />
            <LightYellowPicker
              disabled={mode !== "light"}
              value={lightYellow}
              onChange={setLightYellow}
            />
          </div>
        </header>

        <SectionDivider />

        <nav
          className="sticky top-0 z-20 mt-6 flex flex-wrap gap-2 rounded-lg border border-rule bg-bg/90 p-2 backdrop-blur"
          aria-label="Brand kit sections"
        >
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
        </nav>

        {activeTab === "logos" ? (
          <LogosTab rotation={rotation} onRotationChange={setRotation} />
        ) : null}
        {activeTab === "asciihedron" ? (
          <AsciihedronTab rotation={rotation} onRotationChange={setRotation} />
        ) : null}
        {activeTab === "wordmark" ? <WordmarkTab /> : null}
        {activeTab === "socials" ? <SocialsTab /> : null}
      </div>
    </main>
  );
}
