export interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function hexToRgb01(hex: unknown): Rgb01 | null {
  if (!isHexColor(hex)) return null;
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}
