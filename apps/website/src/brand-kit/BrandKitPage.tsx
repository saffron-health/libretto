import { useRef, useState } from "react";
import type * as React from "react";
import { AsciiLogo } from "../components/AsciiLogo.js";
import { CanvasAsciihedron } from "../components/CanvasAsciihedron.js";
import { Kicker } from "../components/Kicker.js";
import { Panel } from "../components/Panel.js";
import { SectionDivider } from "../components/SectionDivider.js";
import { Text } from "../components/Text.js";
import { SolidIcosahedron } from "./SolidIcosahedron.js";

type BrandTab = "logos" | "asciihedron" | "wordmark";
type ThemeMode = "dark" | "light";

type CSSVarStyle = React.CSSProperties & Record<`--${string}`, string>;

interface DownloadAsset {
  label: string;
  detail: string;
  href: string;
  download: string;
}

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
    "--color-amber": "#9f7614",
    "--color-amber-bright": "#9f7614",
  },
};

const tabs: { id: BrandTab; label: string }[] = [
  { id: "logos", label: "Logos" },
  { id: "asciihedron", label: "Asciihedron" },
  { id: "wordmark", label: "Wordmark" },
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
];

const asciihedronStillAssets: DownloadAsset[] = [
  {
    label: "PNG",
    detail: "2740px transparent still",
    href: "/brand-kit/logos/libretto-asciihedron-still.png",
    download: "libretto-asciihedron-still.png",
  },
  {
    label: "SVG",
    detail: "SVG wrapper for layout tools",
    href: "/brand-kit/logos/libretto-asciihedron-still.svg",
    download: "libretto-asciihedron-still.svg",
  },
  {
    label: "WebP",
    detail: "Compressed web still",
    href: "/brand-kit/logos/libretto-asciihedron-still.webp",
    download: "libretto-asciihedron-still.webp",
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
        aria-label="Light mode yellow"
      />
      <span className="font-mono text-xs text-faint">{value}</span>
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

function RecordCanvasButton({
  children,
  extension,
  mimeType,
  targetRef,
}: {
  children: React.ReactNode;
  extension: "mp4" | "webm";
  mimeType: string;
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [status, setStatus] = useState<"idle" | "recording" | "unsupported">(
    "idle",
  );

  async function handleRecord() {
    const canvas = targetRef.current?.querySelector("canvas");
    if (
      !canvas ||
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported(mimeType) ||
      !("captureStream" in canvas)
    ) {
      setStatus("unsupported");
      return;
    }

    setStatus("recording");
    const stream = canvas.captureStream(30);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener(
      "stop",
      () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `libretto-canvas-animation.${extension}`;
        link.click();
        URL.revokeObjectURL(url);
        stream.getTracks().forEach((track) => track.stop());
        setStatus("idle");
      },
      { once: true },
    );
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    recorder.stop();
  }

  return (
    <button
      type="button"
      onClick={handleRecord}
      className="rounded-md border border-rule bg-panel-hi p-4 text-left transition-colors hover:border-accent/50 hover:bg-panel"
    >
      <span className="block font-mono text-sm font-semibold text-ink">
        {status === "recording" ? "Recording..." : children}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted">
        {status === "unsupported"
          ? `${extension.toUpperCase()} recording is not supported in this browser.`
          : "Records a 3-second loop from the live canvas."}
      </span>
    </button>
  );
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[560px] items-center justify-center overflow-hidden rounded-lg border border-rule bg-bg p-8">
      {children}
    </div>
  );
}

function LogosTab() {
  const [showStill, setShowStill] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  return (
    <BrandTabPanel
      kicker="Primary mark"
      title="Solid gold icosahedron logo"
      description="Use this as the identity anchor. The still exports are posed at x=0, y=144, z=18."
      still={showStill}
      onStillChange={setShowStill}
      preview={
        <PreviewShell>
          {showStill ? (
            <img
              src="/brand-kit/logos/libretto-icosahedron-yellow-1024.png"
              alt="Libretto solid gold icosahedron logo"
              className="h-[360px] w-[360px] object-contain"
              style={{
                filter:
                  "drop-shadow(0 0 22px color-mix(in oklch, var(--color-amber-bright) 44%, transparent)) drop-shadow(0 0 60px color-mix(in oklch, var(--color-amber-bright) 20%, transparent))",
              }}
            />
          ) : (
            <div ref={previewRef} className="relative flex items-center justify-center">
              <div className="absolute h-[320px] w-[320px] rounded-full bg-amber/20 blur-2xl" />
              <SolidIcosahedron
                autoRotate
                className="relative z-10 h-[420px] w-[420px]"
                rotation={{ x: 0, y: 144, z: 18 }}
                style={{
                  filter:
                    "drop-shadow(0 0 20px color-mix(in oklch, var(--color-amber-bright) 55%, transparent)) drop-shadow(0 0 64px color-mix(in oklch, var(--color-amber-bright) 24%, transparent))",
                }}
              />
            </div>
          )}
        </PreviewShell>
      }
      downloads={
        showStill ? (
          <DownloadGrid assets={logoStillAssets} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DownloadGrid assets={logoMotionAssets} />
            <RecordCanvasButton
              extension="webm"
              mimeType="video/webm;codecs=vp9"
              targetRef={previewRef}
            >
              WebM
            </RecordCanvasButton>
          </div>
        )
      }
    />
  );
}

function AsciihedronTab() {
  const [showStill, setShowStill] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  return (
    <BrandTabPanel
      kicker="Technical texture"
      title="Asciihedron"
      description="Use as a background motif, process texture, or motion layer behind the mark."
      still={showStill}
      onStillChange={setShowStill}
      preview={
        <PreviewShell>
          {showStill ? (
            <CanvasAsciihedron
              className="pointer-events-none h-[1600px] w-[1600px] min-h-[1200px] min-w-[1200px] max-h-[180vw] max-w-[180vw] shrink-0 text-ink"
              showAnnotations={false}
              objectScale={1.2}
              spinSpeed={0}
              baseOpacity={0.11}
            />
          ) : (
            <div ref={previewRef}>
              <CanvasAsciihedron
                className="h-[1600px] w-[1600px] min-h-[1200px] min-w-[1200px] max-h-[180vw] max-w-[180vw] shrink-0 text-ink"
                showAnnotations={false}
                objectScale={1.2}
                baseOpacity={0.11}
              />
            </div>
          )}
        </PreviewShell>
      }
      downloads={
        showStill ? (
          <DownloadGrid assets={asciihedronStillAssets} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <RecordCanvasButton
              extension="mp4"
              mimeType="video/mp4"
              targetRef={previewRef}
            >
              MP4
            </RecordCanvasButton>
            <RecordCanvasButton
              extension="webm"
              mimeType="video/webm;codecs=vp9"
              targetRef={previewRef}
            >
              WebM
            </RecordCanvasButton>
          </div>
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

function BrandTabPanel({
  description,
  downloads,
  kicker,
  onStillChange,
  preview,
  still,
  title,
}: {
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
        </div>
        {typeof still === "boolean" && onStillChange ? (
          <StillToggle checked={still} onChange={onStillChange} />
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
  const [lightYellow, setLightYellow] = useState("#d1c115");
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
          className="sticky top-0 z-20 mt-6 flex gap-2 rounded-lg border border-rule bg-bg/90 p-2 backdrop-blur"
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

        {activeTab === "logos" ? <LogosTab /> : null}
        {activeTab === "asciihedron" ? <AsciihedronTab /> : null}
        {activeTab === "wordmark" ? <WordmarkTab /> : null}
      </div>
    </main>
  );
}
