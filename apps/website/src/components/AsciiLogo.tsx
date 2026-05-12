const LOGO = String.raw`
 ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝`;

export function AsciiLogo({ className = "" }: { className?: string }) {
  return (
    <pre
      aria-label="Libretto"
      className={`whitespace-pre leading-none tracking-[0] font-mono text-amber ${className}`}
      style={{
        textShadow:
          "0 0 8px oklch(0.85 0.17 80 / 0.5), 0 0 24px oklch(0.85 0.17 80 / 0.25)",
      }}
    >
      {LOGO}
    </pre>
  );
}
