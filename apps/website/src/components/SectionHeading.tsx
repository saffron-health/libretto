import { Text } from "./Text";

type HeadingSize = "sm" | "md";

const sizes: Record<HeadingSize, { fontSize: string; lineHeight: number }> = {
  md: { fontSize: "clamp(32px, 4vw, 48px)", lineHeight: 1.15 },
  sm: { fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.2 },
};

interface SectionHeadingProps {
  children: React.ReactNode;
  className?: string;
  size?: HeadingSize;
}

export function SectionHeading({
  children,
  className = "",
  size = "md",
}: SectionHeadingProps) {
  const { fontSize, lineHeight } = sizes[size];

  return (
    <Text
      as="h2"
      size="3xl"
      style="serif"
      className={`tracking-[-0.02em] text-ink ${className}`}
      htmlStyle={{ fontWeight: 300, fontSize, lineHeight }}
    >
      {children}
    </Text>
  );
}
