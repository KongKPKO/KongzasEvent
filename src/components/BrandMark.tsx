interface BrandStarProps {
  className?: string;
  size?: number;
}

interface BrandWordmarkProps extends BrandStarProps {
  textClassName?: string;
}

export function BrandStar({ className = '', size = 20 }: BrandStarProps) {
  return (
    <svg
      className={`paimon-brand-mark brand-star ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="brand-star-core"
        d="M12 1.75c.76 4.75 2.5 7.2 7.5 8.08-5 .87-6.74 3.32-7.5 8.07-.76-4.75-2.5-7.2-7.5-8.07 5-.88 6.74-3.33 7.5-8.08Z"
        fill="currentColor"
      />
      <path
        className="brand-star-compass"
        d="M12 5.2 13.1 9l3.7.83-3.7.82L12 14.45l-1.1-3.8-3.7-.82L10.9 9 12 5.2Z"
        fill="currentColor"
        fillOpacity="0.42"
      />
      <circle className="brand-star-orbit" cx="19.35" cy="4.65" r="1.15" fill="currentColor" fillOpacity="0.72" />
      <circle className="brand-star-orbit" cx="5.1" cy="18.95" r="0.8" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

export function BrandWordmark({ className = '', textClassName = '', size = 20 }: BrandWordmarkProps) {
  return (
    <span className={`paimon-wordmark brand-wordmark inline-flex items-center gap-1.5 ${className}`.trim()}>
      <BrandStar size={size} />
      <span className={`brand-wordmark-text ${textClassName}`.trim()}>Paimon</span>
    </span>
  );
}
