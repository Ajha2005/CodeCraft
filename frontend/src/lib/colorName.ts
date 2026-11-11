// Gives every player's map colour a name.
//
// The server hands out colours (see backend/src/common/color/color.util.ts):
// one per player, spread around the colour wheel. This turns that hex value
// into a name worth saying out loud, e.g. "Ember Vermilion". It is a pure
// function of the hex, so a player's colour always has the same name, on every
// device. Names are built from a hue family (~10 degrees wide) plus a modifier
// chosen from the exact colour, so neighbours on the wheel rarely share one.
// The hex code stays the one true identifier; the name is for people.

export interface ColorIdentity {
  hex: string;
  name: string;
  /** The hue family on its own ("Vermilion"). */
  family: string;
  /** 0-359. */
  hue: number;
}

/** Hue families, every 10 degrees starting at 0 (red). */
const FAMILIES = [
  'Crimson',
  'Vermilion',
  'Ember',
  'Tangerine',
  'Amber',
  'Marigold',
  'Saffron',
  'Citron',
  'Chartreuse',
  'Lime',
  'Fern',
  'Jade',
  'Emerald',
  'Mint',
  'Seafoam',
  'Aqua',
  'Turquoise',
  'Cyan',
  'Azure',
  'Cerulean',
  'Sapphire',
  'Cobalt',
  'Indigo',
  'Ultramarine',
  'Iris',
  'Violet',
  'Amethyst',
  'Orchid',
  'Magenta',
  'Fuchsia',
  'Rose',
  'Cerise',
  'Raspberry',
  'Ruby',
  'Scarlet',
  'Poppy',
] as const;

/** Modifiers. Picked from the exact colour, so the same hex always gets the same one. */
const MODIFIERS = [
  'Blazing',
  'Electric',
  'Neon',
  'Radiant',
  'Solar',
  'Lunar',
  'Cosmic',
  'Royal',
  'Velvet',
  'Midnight',
  'Dawn',
  'Dusk',
  'Storm',
  'Thunder',
  'Crystal',
  'Frost',
  'Ember',
  'Phantom',
  'Silken',
  'Prism',
  'Wild',
  'Bold',
  'Brave',
  'Swift',
  'Noble',
  'Lucky',
  'Arcane',
  'Mythic',
  'Gilded',
  'Stellar',
  'Vivid',
  'Fierce',
] as const;

const HEX = /^#?([0-9a-f]{6})$/i;

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = HEX.exec(hex.trim());
  const v = m ? m[1] : '22d3ee';
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The name and hue family of a colour. Never throws: a bad value reads as the default cyan. */
export function colorIdentity(hex: string | null | undefined): ColorIdentity {
  const clean = HEX.test((hex ?? '').trim()) ? `#${HEX.exec((hex ?? '').trim())![1].toLowerCase()}` : '#22d3ee';
  const { h, s, l } = hexToHsl(clean);
  const family = FAMILIES[Math.floor(((h + 5) % 360) / 10)];
  // Lightness / saturation nudge the pick, so a pale and a deep shade of one family differ.
  const seed = hash(clean) + Math.round(l * 10) * 7 + Math.round(s * 10) * 13;
  const modifier = MODIFIERS[seed % MODIFIERS.length];
  // A modifier that repeats the family ("Ember Ember") reads badly: take the next one.
  const pick = modifier === family ? MODIFIERS[(seed + 1) % MODIFIERS.length] : modifier;
  return { hex: clean, name: `${pick} ${family}`, family, hue: Math.round(h) % 360 };
}

export function colorName(hex: string | null | undefined): string {
  return colorIdentity(hex).name;
}
