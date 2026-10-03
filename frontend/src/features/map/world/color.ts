// Tiny color toolkit for the canvas renderer. Everything here is pure and
// cached, because the renderer asks for the same handful of colors (owner
// colors, their darkened wall variants, ...) many times per frame.

export type RGB = readonly [number, number, number];

const rgbCache = new Map<string, RGB>();

export function parseColor(input: string): RGB {
  const cached = rgbCache.get(input);
  if (cached) return cached;

  let rgb: RGB = [148, 163, 184];
  const hex = input.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    rgb = [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  } else if (/^[0-9a-f]{6}$/i.test(hex)) {
    rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  rgbCache.set(input, rgb);
  return rgb;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbString(rgb: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${clamp255(rgb[0])},${clamp255(rgb[1])},${clamp255(rgb[2])})`
    : `rgba(${clamp255(rgb[0])},${clamp255(rgb[1])},${clamp255(rgb[2])},${alpha})`;
}

export function rgba(color: string, alpha: number): string {
  return rgbString(parseColor(color), alpha);
}

/** Linear blend, t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return rgbString([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

export function darken(color: string, amount: number): string {
  return mix(color, '#02050a', amount);
}

export function lighten(color: string, amount: number): string {
  return mix(color, '#ffffff', amount);
}

/** Relative luminance, 0..1 - used to pick readable label colors. */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
