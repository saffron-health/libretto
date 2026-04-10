export function AWSLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="60"
        y="24"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="28"
        letterSpacing="2"
        fill="currentColor"
      >
        AWS
      </text>
      <path
        d="M30 30 C50 36, 70 36, 90 30"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M85 28 L91 30 L87 34"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
