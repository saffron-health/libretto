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
          "0 0 8px color-mix(in oklch, var(--color-amber-bright) 50%, transparent), 0 0 24px color-mix(in oklch, var(--color-amber-bright) 25%, transparent)",
      }}
    >
      {LOGO}
    </pre>
  );
}
