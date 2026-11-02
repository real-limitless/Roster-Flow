/** Deterministic blob avatar from a seat id. No uploads. */

import { avatarPalette } from "./avatarPalette";

export function SeatAvatar({
  seed,
  kind,
  size = 28,
  className = "",
}: {
  seed: string;
  kind?: string;
  size?: number;
  className?: string;
}) {
  const p = avatarPalette(seed);
  return (
    <svg
      className={`av blob ${kind || ""} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      data-testid={`avatar-${seed}`}
    >
      <circle cx="16" cy="16" r="16" fill={p.bg} />
      <ellipse cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill={p.mid} opacity="0.9" />
      <ellipse cx={32 - p.x} cy={32 - p.y} rx={p.ry} ry={p.rx} fill={p.fg} opacity="0.75" />
      <circle cx="16" cy="18" r="4.5" fill={p.fg} opacity="0.35" />
    </svg>
  );
}
