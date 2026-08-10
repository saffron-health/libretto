/** Y Combinator mark — orange square with white Y. */
export function YCLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      {...props}
    >
      <rect width="16" height="16" fill="#FF6600" />
      <path
        fill="#fff"
        d="M8.05 9.1 4.7 3.2h1.95l1.95 3.55c.18.34.32.62.42.88.1-.26.25-.55.45-.9L11.4 3.2h1.85L9.85 9.1V13H8.05V9.1Z"
      />
    </svg>
  );
}
