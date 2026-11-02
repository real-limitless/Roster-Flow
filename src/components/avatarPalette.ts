/** Deterministic blob colors and geometry from a seat id. No uploads. */

export function hashSeatSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarPalette(seed: string) {
  const h = hashSeatSeed(seed || "seat");
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 50)) % 360;
  // Unsigned shifts. Arithmetic >> sign-extends, so a hash with the high bit
  // set makes `%` negative. `5 + (-6)` is the ry=-1 the browser rejects on <ellipse>.
  return {
    bg: `hsl(${hue} 42% 22%)`,
    mid: `hsl(${hue2} 55% 48%)`,
    fg: `hsl(${(hue + 180) % 360} 48% 68%)`,
    x: 10 + (h % 12),
    y: 9 + ((h >>> 4) % 12),
    rx: 6 + ((h >>> 8) % 7),
    ry: 5 + ((h >>> 12) % 7),
  };
}
