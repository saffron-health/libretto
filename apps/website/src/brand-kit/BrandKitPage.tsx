import { useMemo, useState } from "react";
import type * as React from "react";
import { AsciiLogo } from "../components/AsciiLogo.js";
import { Button } from "../components/Button.js";
import { CanvasAsciihedron } from "../components/CanvasAsciihedron.js";
import { Kicker } from "../components/Kicker.js";
import { Panel } from "../components/Panel.js";
import { SectionDivider } from "../components/SectionDivider.js";
import { SectionHeading } from "../components/SectionHeading.js";
import { Text } from "../components/Text.js";

interface BrandColors {
  accent: string;
  amber: string;
  bg: string;
  faint: string;
  ink: string;
  muted: string;
  panel: string;
  panelHi: string;
  rule: string;
}

type ColorKey = keyof BrandColors;

type CSSVarStyle = React.CSSProperties & Record<`--${string}`, string>;

const darkColors: BrandColors = {
  bg: "#111111",
  panel: "#171917",
  panelHi: "#202320",
  rule: "#262a26",
  ink: "#ebeeeb",
  muted: "#abb7ab",
  faint: "#596359",
  accent: "#12ce41",
  amber: "#f0cf5a",
};

const lightColors: BrandColors = {
  bg: "#f3f5f1",
  panel: "#ffffff",
  panelHi: "#e8ede6",
  rule: "#cdd6ca",
  ink: "#101410",
  muted: "#4f5d4f",
  faint: "#7a887a",
  accent: "#0c9f32",
  amber: "#9f7614",
};

const colorLabels: Record<ColorKey, string> = {
  bg: "Background",
  panel: "Panel",
  panelHi: "Panel high",
  rule: "Rule",
  ink: "Ink",
  muted: "Muted",
  faint: "Faint",
  accent: "Accent",
  amber: "Logo amber",
};

function colorStyle(colors: BrandColors): CSSVarStyle {
  return {
    "--color-bg": colors.bg,
    "--color-panel": colors.panel,
    "--color-panel-hi": colors.panelHi,
    "--color-rule": colors.rule,
    "--color-ink": colors.ink,
    "--color-muted": colors.muted,
    "--color-faint": colors.faint,
    "--color-accent": colors.accent,
    "--color-accent-bright": colors.accent,
    "--color-accent-dim": colors.accent,
    "--color-amber": colors.amber,
    "--color-amber-bright": colors.amber,
  };
}

function toCssVariables(colors: BrandColors) {
  return [
    `--color-bg: ${colors.bg};`,
    `--color-panel: ${colors.panel};`,
    `--color-panel-hi: ${colors.panelHi};`,
    `--color-rule: ${colors.rule};`,
    `--color-ink: ${colors.ink};`,
    `--color-muted: ${colors.muted};`,
    `--color-faint: ${colors.faint};`,
    `--color-accent: ${colors.accent};`,
    `--color-amber-bright: ${colors.amber};`,
  ].join("\n");
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value);
}

function AssetCard({
  caption,
  children,
  title,
}: {
  caption: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Panel className="flex min-h-[320px] flex-col justify-between gap-5">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-rule bg-bg">
        {children}
      </div>
      <div>
        <Text as="h3" size="md" className="font-medium text-ink">
          {title}
        </Text>
        <Text as="p" size="sm" className="mt-2 leading-relaxed text-muted">
          {caption}
        </Text>
      </div>
    </Panel>
  );
}

function ColorControl({
  colorKey,
  value,
  onChange,
}: {
  colorKey: ColorKey;
  value: string;
  onChange: (key: ColorKey, value: string) => void;
}) {
  return (
    <label className="grid gap-3 rounded-md border border-rule bg-panel-hi p-3">
      <span className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase text-muted">
          {colorLabels[colorKey]}
        </span>
        <span className="font-mono text-xs text-faint">{value}</span>
      </span>
      <span className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(colorKey, event.target.value)}
          className="h-10 w-12 cursor-pointer border-0 bg-transparent p-0"
          aria-label={`${colorLabels[colorKey]} color`}
        />
        <span
          className="h-10 flex-1 rounded border border-rule"
          style={{ background: value }}
        />
      </span>
    </label>
  );
}

function ExportButton({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Button type="button" onClick={handleClick}>
      {copied ? "Copied" : children}
    </Button>
  );
}

export function BrandKitPage() {
  const [isLightMode, setIsLightMode] = useState(false);
  const [colors, setColors] = useState<BrandColors>(darkColors);

  const cssVariables = useMemo(() => toCssVariables(colors), [colors]);
  const jsonTokens = useMemo(() => JSON.stringify(colors, null, 2), [colors]);

  function handleModeToggle() {
    setIsLightMode((value) => {
      const nextMode = !value;
      setColors(nextMode ? lightColors : darkColors);
      return nextMode;
    });
  }

  function handleColorChange(key: ColorKey, value: string) {
    setColors((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="min-h-screen bg-bg text-ink" style={colorStyle(colors)}>
      <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10 md:px-10">
        <header className="flex flex-col gap-8 pb-10 md:flex-row md:items-end md:justify-between">
          <div>
            <Kicker className="mb-4">Libretto brand kit</Kicker>
            <Text
              as="h1"
              size="5xl"
              style="serif"
              className="crt-glow max-w-[760px] text-ink [text-wrap:balance]"
              htmlStyle={{
                fontWeight: 300,
                fontSize: "clamp(44px, 7vw, 88px)",
                lineHeight: 1,
              }}
            >
              Technical, legible, agent-native.
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={isLightMode ? "primary" : "secondary"}
              onClick={handleModeToggle}
            >
              {isLightMode ? "Dark mode" : "Light mode"}
            </Button>
            <ExportButton value={cssVariables}>Copy CSS</ExportButton>
            <ExportButton value={jsonTokens}>Copy JSON</ExportButton>
          </div>
        </header>

        <SectionDivider />

        <section className="grid gap-8 py-12">
          <div>
            <SectionHeading size="sm" className="mb-3">
              Assets
            </SectionHeading>
            <Text as="p" size="md" className="max-w-[680px] leading-relaxed text-muted">
              Core marks are rendered live so color changes can be previewed
              before exports are finalized.
            </Text>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <AssetCard title="Icosahedron" caption="Live canvas mark using the current ink token.">
              <CanvasAsciihedron
                className="h-[420px] w-[420px] text-amber"
                showAnnotations={false}
                objectScale={1.15}
                baseOpacity={0.55}
              />
            </AssetCard>
            <AssetCard title="Asciihedron" caption="Process texture rendered from the same geometry.">
              <CanvasAsciihedron
                className="h-[420px] w-[420px] text-accent"
                showAnnotations={false}
                objectScale={1}
                spinSpeed={0.0002}
                baseOpacity={0.24}
              />
            </AssetCard>
            <AssetCard title="ASCII Font Render" caption="Commit Mono wordmark source for fixed-width contexts.">
              <div className="w-full overflow-hidden px-3">
                <AsciiLogo className="text-[4px] sm:text-[6px] lg:text-[5px]" />
              </div>
            </AssetCard>
          </div>
        </section>

        <SectionDivider />

        <section className="grid gap-8 py-12 lg:grid-cols-[1fr_420px]">
          <div>
            <SectionHeading size="sm" className="mb-5">
              Fonts
            </SectionHeading>
            <div className="grid gap-5 md:grid-cols-2">
              <Panel>
                <Text
                  as="p"
                  style="serif"
                  className="text-ink"
                  htmlStyle={{ fontSize: "clamp(42px, 6vw, 72px)", lineHeight: 0.95 }}
                >
                  Fraunces
                </Text>
                <Text as="p" size="sm" className="mt-5 leading-relaxed text-muted">
                  Editorial serif for headlines, brand statements, and large
                  moments that need warmth.
                </Text>
              </Panel>
              <Panel>
                <Text as="p" className="font-mono text-[32px] font-semibold leading-none text-ink">
                  Commit Mono
                </Text>
                <Text as="p" size="sm" className="mt-5 leading-relaxed text-muted">
                  Primary UI face for labels, controls, commands, terminals, and
                  ASCII-rendered assets.
                </Text>
              </Panel>
            </div>
          </div>

          <div>
            <SectionHeading size="sm" className="mb-5">
              Colors
            </SectionHeading>
            <div className="grid gap-3">
              {(Object.keys(colors) as ColorKey[]).map((key) => (
                <ColorControl
                  key={key}
                  colorKey={key}
                  value={colors[key]}
                  onChange={handleColorChange}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
