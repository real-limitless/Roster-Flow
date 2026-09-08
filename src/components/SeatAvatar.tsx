/** Deterministic blob avatar from a seat id. No uploads. */

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function palette(seed: string) {
  const h = hash(seed || "seat");
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 50)) % 360;
  return {
    bg: `hsl(${hue} 42% 22%)`,
    mid: `hsl(${hue2} 55% 48%)`,
    fg: `hsl(${(hue + 180) % 360} 48% 68%)`,
    x: 10 + (h % 12),
    y: 9 + ((h >> 4) % 12),
    rx: 6 + ((h >> 8) % 7),
    ry: 5 + ((h >> 12) % 7),
  };
}

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
  const p = palette(seed);
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
