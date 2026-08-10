/** Y Combinator mark — official orange square with white Y. */
export function YCLogo({
  className,
  width = 14,
  height = 14,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  return (
    <img
      src="/yc-logo.png"
      alt=""
      width={width}
      height={height}
      className={className}
      draggable={false}
      {...props}
    />
  );
}
