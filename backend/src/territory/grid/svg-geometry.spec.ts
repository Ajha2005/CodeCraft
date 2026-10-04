import * as fs from 'fs';
import * as path from 'path';
import {
  boundsOf,
  flattenPath,
  parseZones,
  pointInPolygon,
  polygonArea,
} from './svg-geometry';

const repoRoot = path.join(__dirname, '..', '..', '..', '..');
const svgFile = path.join(
  repoRoot,
  'frontend',
  'src',
  'assets',
  'campus-map.svg',
);
const frontendGeometry = path.join(
  repoRoot,
  'frontend',
  'src',
  'features',
  'map',
  'world',
  'geometry.ts',
);

describe('flattenPath / boundsOf / polygonArea / pointInPolygon', () => {
  it('reads a rectangle with relative and absolute commands', () => {
    const poly = flattenPath('M10 20 h30 v40 H10 Z');
    expect(poly).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
    expect(boundsOf(poly)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(polygonArea(poly)).toBe(1200);
  });

  it('measures area whichever way round the outline runs', () => {
    expect(polygonArea(flattenPath('M0 0 L0 10 L10 10 L10 0 Z'))).toBe(100);
    expect(polygonArea(flattenPath('M0 0 L10 0 L10 10 L0 10 Z'))).toBe(100);
  });

  it('samples a cubic curve into its outline', () => {
    const poly = flattenPath('M0 0 C0 10 10 10 10 0 Z');
    expect(poly.length).toBe(11); // the start plus ten samples
    expect(poly[poly.length - 1].x).toBeCloseTo(10, 9);
  });

  it('tests points with the even-odd rule', () => {
    const poly = flattenPath('M0 0 L10 0 L10 10 L0 10 Z');
    expect(pointInPolygon(5, 5, poly)).toBe(true);
    expect(pointInPolygon(15, 5, poly)).toBe(false);
    expect(pointInPolygon(-1, 5, poly)).toBe(false);
  });
});

describe('parseZones', () => {
  const svg = fs.readFileSync(svgFile, 'utf-8');
  const zones = parseZones(svg);

  it('finds the 46 zones of the campus map, in document order, with unique ids', () => {
    expect(zones.length).toBe(46);
    expect(new Set(zones.map((z) => z.id)).size).toBe(46);
  });

  it('gives every zone an outline, a box that contains it and a positive area', () => {
    for (const z of zones) {
      expect(z.poly.length).toBeGreaterThanOrEqual(3);
      expect(z.area).toBeGreaterThan(0);
      for (const p of z.poly) {
        expect(p.x).toBeGreaterThanOrEqual(z.box.x - 1e-9);
        expect(p.x).toBeLessThanOrEqual(z.box.x + z.box.w + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(z.box.y - 1e-9);
        expect(p.y).toBeLessThanOrEqual(z.box.y + z.box.h + 1e-9);
      }
    }
  });

  it('ignores paths without an id or a path', () => {
    expect(
      parseZones('<svg><path d="M0 0 L1 0 L1 1 Z"/><path id="x"/></svg>'),
    ).toEqual([]);
  });

  // The server decides where cells are with these outlines and boxes; the browser draws them with its own
  // copy of the same code. If the two ever drift, cells would be drawn in different places than they were made for.
  const maybe = fs.existsSync(frontendGeometry) ? it : it.skip;
  maybe('matches the geometry the map draws with, zone by zone', () => {
    const restore = installDomParserShim();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const drawn = require(frontendGeometry).parseCampus(svg).zones as {
        id: string;
        poly: { x: number; y: number }[];
        box: { x: number; y: number; w: number; h: number };
        area: number;
      }[];
      expect(drawn.map((z) => z.id)).toEqual(zones.map((z) => z.id));
      drawn.forEach((front, i) => {
        const back = zones[i];
        expect(back.poly.length).toBe(front.poly.length);
        back.poly.forEach((p, k) => {
          expect(p.x).toBeCloseTo(front.poly[k].x, 9);
          expect(p.y).toBeCloseTo(front.poly[k].y, 9);
        });
        expect(back.box.x).toBeCloseTo(front.box.x, 9);
        expect(back.box.y).toBeCloseTo(front.box.y, 9);
        expect(back.box.w).toBeCloseTo(front.box.w, 9);
        expect(back.box.h).toBeCloseTo(front.box.h, 9);
        expect(back.area).toBeCloseTo(front.area, 6);
      });
    } finally {
      restore();
    }
  });
});

/** The map reads the SVG with the browser's DOMParser; this stands in for it, reading attributes straight from the markup. */
function installDomParserShim(): () => void {
  const scope = globalThis as { DOMParser?: unknown };
  const before = scope.DOMParser;
  const attribute = (tag: string) => (name: string) =>
    new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  scope.DOMParser = class {
    parseFromString(markup: string) {
      const svgTag = /<svg\b[^>]*>/.exec(markup)?.[0] ?? '';
      const paths = (markup.match(/<path\b[^>]*>/g) ?? [])
        .filter((tag) => /\sid="/.test(tag))
        .map((tag) => ({ getAttribute: attribute(tag) }));
      return {
        documentElement: { getAttribute: attribute(svgTag) },
        querySelectorAll: () => ({
          forEach: (
            fn: (el: { getAttribute: (n: string) => string | null }) => void,
          ) => paths.forEach(fn),
        }),
      };
    }
  };
  return () => {
    scope.DOMParser = before;
  };
}
