export function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.6 9.6 13.5 13.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SearchButton({
  onClick,
  label = "Search",
  testId,
  className,
}: {
  onClick: () => void;
  label?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`search-btn ${className || ""}`.trim()}
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <SearchIcon />
    </button>
  );
}
