export function SectionDivider() {
  return (
    <div
      className="relative h-8 w-full border-y border-rule"
      style={{
        background:
          "repeating-linear-gradient(315deg, color-mix(in oklch, var(--color-green-9) 8%, transparent) 0, color-mix(in oklch, var(--color-green-9) 8%, transparent) 1px, transparent 0, transparent 50%)",
        backgroundSize: "10px 10px",
      }}
    />
  );
}
