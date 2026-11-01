import { colorFromIndex, lookupUserColor, UNCLAIMED_COLOR } from './color.util';

describe('colorFromIndex', () => {
  it('gives every one of the first 10,000 players a different colour', () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 10000; i++) seen.add(colorFromIndex(i));
    expect(seen.size).toBe(10000);
  });

  it('is stable for the same index', () => {
    expect(colorFromIndex(42)).toBe(colorFromIndex(42));
  });

  it('is always a vivid hex colour, never grey', () => {
    for (let i = 0; i <= 500; i++) {
      const hex = colorFromIndex(i);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(hex).not.toBe(UNCLAIMED_COLOR);
      const [r, g, b] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(90);
    }
  });

  it('puts consecutive players on clearly different hues', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (let i = 1; i < 12; i++) {
      const gap = Math.abs(hue(colorFromIndex(i)) - hue(colorFromIndex(i + 1)));
      expect(Math.min(gap, 360 - gap)).toBeGreaterThan(60);
    }
  });
});

describe('lookupUserColor', () => {
  it('reads the colour from the stored sequence number', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ colorIndex: 7 }) } };
    await expect(lookupUserColor(db, 'u1')).resolves.toBe(colorFromIndex(7));
  });

  it('falls back to the unclaimed grey for an unknown or missing player', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(lookupUserColor(db, 'ghost')).resolves.toBe(UNCLAIMED_COLOR);
    await expect(lookupUserColor(db, null)).resolves.toBe(UNCLAIMED_COLOR);
  });
});
