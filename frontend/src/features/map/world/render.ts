import type { Campus, Pt, Zone } from './geometry';
import type { LaneMark } from './nav';
import type { Fx } from './fx';
import { DecorKit, baseRoof, tintStrength } from './decor';
import { darken, lighten, mix, rgba } from './color';
import { OBL_X, cellKey, liftedHeight, type ZoneView } from './scene';
import { FONT_DISPLAY, FONT_MONO, PALETTE, TIER_STYLE } from './theme';

// The world renderer. One call to `draw` paints a whole frame:
//
//   void + stars -> floating slab -> streets -> zone blocks (back to front)
//   -> cloud shadows -> labels -> route/avatar/effects -> screen-space motes
//
// Coordinates: the zone's svg polygon is its *footprint on the ground*. A
// block's roof floats `height` above that, drawn up and to the left of the
// footprint (oblique projection), with the south and east walls visible.

const SIDEWALK = 11;
const SLAB_MARGIN = 44;
const SLAB_THICKNESS = 70;

export interface TrailPoint {
  x: number;
  y: number;
  lift: number;
  age: number;
}

export interface PlayerRender {
  x: number;
  y: number;
  heading: number;
  speed: number;
  lift: number;
  phase: number;
  sprint: boolean;
  color: string;
  trail: TrailPoint[];
  /** 0..1 pulse of the "arrived" / "entered zone" ring. */
  ping: number;
}

export interface HoverCellRef {
  zone: number;
  row: number;
  col: number;
  challengeable: boolean;
}

export interface Frame {
  /** Animation clock, seconds. Frozen at 0 when reduced motion is on. */
  anim: number;
  dt: number;
  cx: number;
  cy: number;
  zoom: number;
  vw: number;
  vh: number;
  dpr: number;
  shakeX: number;
  shakeY: number;
  views: ZoneView[];
  /** Zone indices, back to front. */
  order: number[];
  hoverZone: number;
  selectZone: number;
  currentZone: number;
  waypointZone: number;
  hoverCell: HoverCellRef | null;
  player: PlayerRender;
  route: Pt[];
  routeIndex: number;
  destination: Pt | null;
  waypoint: Pt | null;
  fx: Fx;
  meId: string | null;
  meColor: string;
  reduced: boolean;
  /** Adaptive quality: true drops purely decorative effects on slow devices. */
  lowFx: boolean;
}

interface Star {
  fx: number;
  fy: number;
  d: number;
  s: number;
  a: number;
}

interface Cloud {
  x: number;
  y: number;
  r: number;
  vx: number;
}

interface Mote {
  fx: number;
  fy: number;
  d: number;
  s: number;
  ph: number;
  vx: number;
}

/** Rounded rectangle via arcTo, which every browser has (roundRect is newer). */
function roundedRect(t: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  t.moveTo(x + rr, y);
  t.arcTo(x + w, y, x + w, y + h, rr);
  t.arcTo(x + w, y + h, x, y + h, rr);
  t.arcTo(x, y + h, x, y, rr);
  t.arcTo(x, y, x + w, y, rr);
  t.closePath();
}

const ICONS = new Map<string, Path2D>();
function iconPath(d: string): Path2D {
  let p = ICONS.get(d);
  if (!p) {
    p = new Path2D(d);
    ICONS.set(d, p);
  }
  return p;
}

export class WorldRenderer {
  private readonly decor = new DecorKit();
  private readonly stars: Star[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly motes: Mote[] = [];
  private readonly orient: number[] = [];
  private readonly slabPath: Path2D;
  private readonly groundTex: HTMLCanvasElement;
  private readonly labelWidthCache = new Map<string, number>();
  private readonly lanePath: Path2D;
  private readonly lampPoints: Pt[] = [];
  /** Every zone outline merged, so the pavement is two strokes, not ninety. */
  private readonly allZones: Path2D;
  /** Everything outside the slab: clip target for drawing only its visible edge. */
  private readonly slabOutside: Path2D;

  // exact viewport in world units for the current frame
  private tx0 = 0;
  private ty0 = 0;
  private tx1 = 0;
  private ty1 = 0;
  // visible world rect for the current frame (padded for culling)
  private vx0 = 0;
  private vy0 = 0;
  private vx1 = 0;
  private vy1 = 0;

  private readonly campus: Campus;

  constructor(campus: Campus, laneMarks: LaneMark[]) {
    this.campus = campus;
    const rand = (seed: number) => {
      let a = seed;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
    };
    const r = rand(99);
    for (let i = 0; i < 170; i++) this.stars.push({ fx: r(), fy: r(), d: 0.03 + r() * 0.2, s: 0.6 + r() * 1.5, a: 0.15 + r() * 0.6 });
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ x: r() * (campus.width + 800), y: r() * campus.height, r: 320 + r() * 380, vx: 7 + r() * 9 });
    }
    for (let i = 0; i < 38; i++) this.motes.push({ fx: r(), fy: r(), d: 0.5 + r() * 1.1, s: 0.8 + r() * 1.8, ph: r() * 6.28, vx: 4 + r() * 10 });

    for (const z of campus.zones) {
      let a = 0;
      for (let i = 0; i < z.poly.length; i++) {
        const p = z.poly[i];
        const q = z.poly[(i + 1) % z.poly.length];
        a += p.x * q.y - q.x * p.y;
      }
      this.orient[z.index] = a >= 0 ? 1 : -1;
    }

    // Slab outline (rounded rect) shared by every pass.
    const x0 = -SLAB_MARGIN;
    const y0 = -SLAB_MARGIN;
    const w = campus.width + SLAB_MARGIN * 2;
    const h = campus.height + SLAB_MARGIN * 2;
    this.slabPath = new Path2D();
    roundedRect(this.slabPath, x0, y0, w, h, 52);
    this.slabOutside = new Path2D();
    this.slabOutside.rect(-6000, -6000, 15000, 15000);
    this.slabOutside.addPath(this.slabPath);

    this.allZones = new Path2D();
    for (const z of campus.zones) this.allZones.addPath(new Path2D(z.d));

    // Street dashes batched into one path; a sparse subset becomes lamps.
    this.lanePath = new Path2D();
    for (const m of laneMarks) {
      const key = Math.round(m.x / 10) * 7 + Math.round(m.y / 10) * 13;
      if (m.dir === 'h') {
        if (Math.round(m.x / 10) % 3 === 0) this.lanePath.rect(m.x - 5, m.y - 0.9, 10, 1.8);
      } else if (Math.round(m.y / 10) % 3 === 0) {
        this.lanePath.rect(m.x - 0.9, m.y - 5, 1.8, 10);
      }
      if (key % 41 === 0) this.lampPoints.push({ x: m.x, y: m.y });
    }

    this.groundTex = document.createElement('canvas');
    this.groundTex.width = 640;
    this.groundTex.height = 340;
    const g = this.groundTex.getContext('2d') as CanvasRenderingContext2D;
    const rr = rand(2024);
    // Island lighting is baked in here (brighter core, darker rim) so each
    // frame needs one textured fill instead of three full-screen gradients.
    const base = g.createRadialGradient(320, 170, 8, 320, 170, 390);
    base.addColorStop(0, '#112538');
    base.addColorStop(1, '#09131e');
    g.fillStyle = base;
    g.fillRect(0, 0, 640, 340);
    for (let i = 0; i < 90; i++) {
      const x = rr() * 640;
      const y = rr() * 340;
      const rad = 20 + rr() * 90;
      const tint = rr();
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = tint < 0.4 ? '34,211,238' : tint < 0.75 ? '20,120,110' : '60,90,160';
      grad.addColorStop(0, `rgba(${c},${0.025 + rr() * 0.04})`);
      grad.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(150,200,230,${0.015 + rr() * 0.03})`;
      g.fillRect(rr() * 640, rr() * 340, 1, 1);
    }
    const rim = g.createRadialGradient(320, 170, 210, 320, 170, 410);
    rim.addColorStop(0, 'rgba(2,6,12,0)');
    rim.addColorStop(1, 'rgba(2,6,12,0.55)');
    g.fillStyle = rim;
    g.fillRect(0, 0, 640, 340);
  }

  // ------------------------------------------------------------------ frame

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { vw, vh, dpr, zoom } = f;
    const halfW = vw / (2 * zoom);
    const halfH = vh / (2 * zoom);
    this.tx0 = f.cx - halfW;
    this.tx1 = f.cx + halfW;
    this.ty0 = f.cy - halfH;
    this.ty1 = f.cy + halfH;
    this.vx0 = this.tx0 - 40;
    this.vx1 = this.tx1 + 40;
    this.vy0 = this.ty0 - 40;
    this.vy1 = this.ty1 + 40;

    // When the viewport sits wholly inside the island there is no void, rim
    // or island edge to draw - skipping them is the biggest saving when zoomed in.
    const m = SLAB_MARGIN - 60;
    const inside = this.tx0 > -m && this.tx1 < this.campus.width + m && this.ty0 > -m && this.ty1 < this.campus.height + m;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!inside) this.drawVoid(ctx, f);

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (vw / 2 - f.cx * zoom + f.shakeX), dpr * (vh / 2 - f.cy * zoom + f.shakeY));
    this.drawSlab(ctx, f, inside);
    this.drawStreets(ctx, f);

    for (const idx of f.order) {
      const v = f.views[idx];
      if (this.visible(v.zone, 60)) this.drawZone(ctx, f, v);
    }

    if (!f.lowFx) this.drawClouds(ctx, f);
    this.drawLabels(ctx, f);
    this.drawRoute(ctx, f);
    this.drawPlayer(ctx, f);
    f.fx.draw(ctx, zoom);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!f.lowFx) this.drawMotes(ctx, f);
    this.drawWaypointArrow(ctx, f);
  }

  private visible(z: Zone, pad: number) {
    const b = z.box;
    return !(b.x + b.w + pad < this.vx0 || b.x - pad > this.vx1 || b.y + b.h + pad < this.vy0 || b.y - pad > this.vy1);
  }

  // ------------------------------------------------------------- background

  private drawVoid(ctx: CanvasRenderingContext2D, f: Frame) {
    const { vw, vh } = f;
    const g = ctx.createRadialGradient(vw / 2, vh * 0.55, 0, vw / 2, vh * 0.55, Math.max(vw, vh) * 0.85);
    g.addColorStop(0, PALETTE.voidGlow);
    g.addColorStop(1, PALETTE.void);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    for (const s of this.stars) {
      const x = (((s.fx * vw - f.cx * f.zoom * s.d) % vw) + vw) % vw;
      const y = (((s.fy * vh - f.cy * f.zoom * s.d) % vh) + vh) % vh;
      const tw = f.reduced ? 1 : 0.7 + 0.3 * Math.sin(f.anim * 1.3 + s.fx * 40);
      ctx.fillStyle = `rgba(170,215,255,${s.a * tw})`;
      ctx.fillRect(x, y, s.s, s.s);
    }
  }

  private drawSlab(ctx: CanvasRenderingContext2D, f: Frame, inside: boolean) {
    const { campus } = this;
    const W = campus.width;
    const H = campus.height;
    const zoom = f.zoom;

    if (!inside) {
      // soft glow cast beneath the floating island
      if (this.ty1 > H) {
        ctx.save();
        ctx.translate(W / 2 + 80, H + SLAB_THICKNESS + 190);
        ctx.scale(1, 0.2);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.6);
        glow.addColorStop(0, 'rgba(34,211,238,0.20)');
        glow.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(-W, -W, W * 2, W * 2);
        ctx.restore();
      }

      // thickness: stacked copies darkening with depth, clipped to the band
      // outside the top face so each copy only fills what can be seen.
      if (this.tx1 > W - 100 || this.ty1 > H - 100) {
        ctx.save();
        ctx.clip(this.slabOutside, 'evenodd');
        const steps = 10;
        for (let i = steps; i >= 1; i--) {
          const k = (i / steps) * SLAB_THICKNESS;
          ctx.save();
          ctx.translate(OBL_X * k, k);
          ctx.fillStyle = mix('#173047', '#03070c', i / steps);
          ctx.fill(this.slabPath);
          ctx.restore();
        }
        ctx.restore();
      }
    }

    // top face: one cached texture (lighting baked in) + tactical grid
    ctx.save();
    ctx.clip(this.slabPath);
    ctx.drawImage(this.groundTex, -SLAB_MARGIN, -SLAB_MARGIN, W + SLAB_MARGIN * 2, H + SLAB_MARGIN * 2);

    const gridAlpha = 0.05 + 0.05 * Math.min(1, zoom * 1.2);
    const step = 80;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    const gx0 = Math.floor(Math.max(-SLAB_MARGIN, this.vx0) / step) * step;
    const gx1 = Math.min(W + SLAB_MARGIN, this.vx1);
    const gy0 = Math.floor(Math.max(-SLAB_MARGIN, this.vy0) / step) * step;
    const gy1 = Math.min(H + SLAB_MARGIN, this.vy1);
    for (let x = gx0; x <= gx1; x += step) {
      ctx.moveTo(x, gy0);
      ctx.lineTo(x, gy1);
    }
    for (let y = gy0; y <= gy1; y += step) {
      ctx.moveTo(gx0, y);
      ctx.lineTo(gx1, y);
    }
    ctx.strokeStyle = rgba(PALETTE.cyan, gridAlpha);
    ctx.stroke();
    ctx.restore();

    // glowing rim, as layered strokes rather than a blur
    if (!inside) {
      ctx.lineJoin = 'round';
      this.glowStroke(ctx, this.slabPath, PALETTE.cyan, 2 / zoom, 0.6, f.lowFx);
    }
  }

  /** A cheap glow: three concentric strokes instead of a blurred shadow. */
  private glowStroke(ctx: CanvasRenderingContext2D, path: Path2D | null, color: string, width: number, alpha: number, low = false) {
    const draw = () => (path ? ctx.stroke(path) : ctx.stroke());
    if (low) {
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = width * 1.4;
      draw();
      return;
    }
    ctx.strokeStyle = rgba(color, alpha * 0.13);
    ctx.lineWidth = width * 4.2;
    draw();
    ctx.strokeStyle = rgba(color, alpha * 0.28);
    ctx.lineWidth = width * 2.2;
    draw();
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    draw();
  }

  private drawStreets(ctx: CanvasRenderingContext2D, f: Frame) {
    const zoom = f.zoom;
    ctx.lineJoin = 'round';

    // pavement + curb around every block
    ctx.lineWidth = SIDEWALK * 2 + 3;
    ctx.strokeStyle = PALETTE.curb;
    ctx.stroke(this.allZones);
    ctx.lineWidth = SIDEWALK * 2;
    ctx.strokeStyle = PALETTE.sidewalk;
    ctx.stroke(this.allZones);

    if (zoom > 0.3) {
      ctx.fillStyle = 'rgba(255,214,102,0.34)';
      ctx.fill(this.lanePath);

      // street lamps
      ctx.globalCompositeOperation = 'lighter';
      for (const p of f.lowFx ? [] : this.lampPoints) {
        if (p.x < this.vx0 || p.x > this.vx1 || p.y < this.vy0 || p.y > this.vy1) continue;
        const flick = f.reduced ? 1 : 0.85 + 0.15 * Math.sin(f.anim * 2 + p.x);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 22);
        g.addColorStop(0, `rgba(160,225,255,${0.28 * flick})`);
        g.addColorStop(1, 'rgba(160,225,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 22, p.y - 22, 44, 44);
        ctx.fillStyle = `rgba(230,248,255,${0.8 * flick})`;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------------------- zones

  /** The color a zone's roof reads as, given who holds it. */
  private roofColor(v: ZoneView): string {
    const base = baseRoof(v.zone.kind, v.zone.tier);
    if (!v.topColor || v.fraction <= 0) return base;
    return mix(base, v.topColor, Math.min(1, (0.35 + 0.65 * v.fraction) * tintStrength(v.zone.kind)));
  }

  private drawZone(ctx: CanvasRenderingContext2D, f: Frame, v: ZoneView) {
    const z = v.zone;
    const zoom = f.zoom;
    const h0 = v.height;
    const h = liftedHeight(v);
    const ox = -OBL_X * h;
    const oy = -h;
    const tier = TIER_STYLE[z.tier];
    const mine = !!f.meId && v.topOwnerId === f.meId;
    const detail = v.detail;

    // ground shadow
    if (h0 > 2) {
      const s = h0 * 0.95 + 4;
      ctx.fillStyle = h0 > 9 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.24)';
      for (const k of h0 > 9 && !f.lowFx ? [1.45, 0.75] : [1]) {
        ctx.save();
        ctx.translate(OBL_X * s * k, s * k);
        ctx.fill(v.path);
        ctx.restore();
      }
    }

    // walls
    const roofColor = this.roofColor(v);
    if (h > 1.2) {
      const wallBase = darken(roofColor, 0.52);
      const poly = z.poly;
      const orient = this.orient[z.index];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        const nx = (orient > 0 ? dy : -dy) / len;
        const ny = (orient > 0 ? -dx : dx) / len;
        if (nx * OBL_X + ny <= 0.02) continue;

        const east = Math.max(0, nx);
        const g = ctx.createLinearGradient(0, Math.min(p.y, q.y) + oy, 0, Math.max(p.y, q.y));
        g.addColorStop(0, mix(wallBase, '#ffffff', 0.1 - east * 0.1));
        g.addColorStop(1, darken(wallBase, 0.35 + east * 0.25));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.lineTo(q.x + ox, q.y + oy);
        ctx.lineTo(p.x + ox, p.y + oy);
        ctx.closePath();
        ctx.fill();

        // lit ribbon of windows along tall walls
        if (h0 >= 12 && zoom > 0.5 && !f.lowFx && len > 40 && v.zone.kind !== 'water') {
          ctx.fillStyle = 'rgba(255,224,160,0.22)';
          const ux = dx / len;
          const uy = dy / len;
          const rows = h0 > 24 ? 2 : 1;
          for (let r = 0; r < rows; r++) {
            const t0 = 0.25 + r * 0.38;
            for (let d = 10; d < len - 10; d += 12) {
              if ((Math.floor(d / 12) * 7 + r * 3 + z.index) % 5 === 0) continue;
              const px = p.x + ux * d + ox * t0;
              const py = p.y + uy * d + oy * t0;
              ctx.fillRect(px - 2.2, py - 1.4, 4.4, 2.8);
            }
          }
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x + ox, p.y + oy);
        ctx.lineTo(q.x + ox, q.y + oy);
        ctx.stroke();
      }
    }

    // ---- roof
    ctx.save();
    ctx.translate(ox, oy);
    const terrainFirst = z.kind === 'water' || z.kind === 'forest';

    // A single owner over an opaque base is just a blended color, so paint it
    // in one fill; striped (contested) and terrain-first zones layer instead.
    let roofFill = baseRoof(z.kind, z.tier);
    let blended = false;
    if (!detail && !terrainFirst && v.shares.length === 1 && v.stripes.length === 0) {
      const a = Math.min(1, (0.3 + 0.7 * v.fraction) * tintStrength(z.kind) + 0.05);
      roofFill = mix(roofFill, v.shares[0].color, a);
      blended = true;
    }
    ctx.fillStyle = detail ? mix(roofFill, '#0b121b', 0.55) : roofFill;
    ctx.fill(v.path);

    if (!detail) {
      ctx.save();
      ctx.clip(v.path);
      if (terrainFirst) this.decor.draw(ctx, v, f.anim, zoom, f.lowFx, f.dpr);
      if (!blended) this.paintOwnership(ctx, v, terrainFirst ? 0.5 : 1);
      if (!terrainFirst) this.decor.draw(ctx, v, f.anim, zoom, f.lowFx, f.dpr);
      ctx.restore();
    }

    // sheen
    const b = z.box;
    if (zoom > 0.3 && !f.lowFx) {
      const sheen = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.11)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = sheen;
      ctx.fill(v.path);
    }

    if (detail) this.drawCells(ctx, f, v);

    // unexplored veil
    if (!v.discovered && !detail) {
      ctx.save();
      ctx.clip(v.path);
      ctx.fillStyle = 'rgba(3,9,16,0.46)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(160,200,230,0.07)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let d = -b.h; d < b.w; d += 15) {
        ctx.moveTo(b.x + d, b.y + b.h);
        ctx.lineTo(b.x + d + b.h, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // tier-colored edge
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = rgba(tier.accent, 0.3 + tier.rank * 0.12);
    ctx.stroke(v.path);

    // corner brackets: the higher the tier, the bolder
    if (!detail) this.drawBrackets(ctx, z, rgba(tier.accent, 0.5 + tier.rank * 0.16), 1.6 + tier.rank * 0.5, f.lowFx ? 0 : f.anim, f.lowFx);

    // holdings highlight
    if (mine) this.glowStroke(ctx, v.path, f.meColor, 2.6, 0.95, f.lowFx);

    // contested zones: marching orange ring
    if (v.contested) {
      ctx.save();
      const pulse = f.reduced ? 1 : 0.6 + 0.4 * Math.sin(f.anim * 3.2 + z.seed * 9);
      ctx.setLineDash([11, 7]);
      ctx.lineDashOffset = -f.anim * 22;
      this.glowStroke(ctx, v.path, PALETTE.danger, 2.4, 0.55 + 0.45 * pulse, f.lowFx);
      ctx.restore();
    }

    // capture shockwave on the roof itself
    if (v.capturedAt >= 0 && !f.reduced) {
      const age = f.anim - v.capturedAt;
      if (age >= 0 && age < 1.2) {
        const k = 1 - age / 1.2;
        ctx.save();
        ctx.fillStyle = rgba('#ffffff', 0.55 * k * k);
        ctx.fill(v.path);
        this.glowStroke(ctx, v.path, v.topColor ?? PALETTE.cyan, 4, k, f.lowFx);
        ctx.restore();
      }
    }

    // hover + selection
    if (v.hover > 0.02) {
      this.glowStroke(ctx, v.path, PALETTE.cyan, 3, 0.95 * v.hover, f.lowFx);
    }
    if (v.select > 0.02) {
      ctx.save();
      ctx.setLineDash([16, 9]);
      ctx.lineDashOffset = -f.anim * 28;
      this.glowStroke(ctx, v.path, '#ffffff', 2.6, 0.92 * v.select, f.lowFx);
      ctx.restore();
    }
    if (f.currentZone === z.index && !detail) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(f.meColor, 0.35 + (f.reduced ? 0.2 : 0.2 * Math.sin(f.anim * 4)));
      ctx.stroke(v.path);
    }

    if (z.tier === 'CITADEL' && !detail && !f.lowFx) this.drawBeacon(ctx, f, v, tier.accent);
    if (v.mineCount > 0 && !detail) this.drawPennant(ctx, z, f.meColor, f.anim);

    ctx.restore();
  }

  private paintOwnership(ctx: CanvasRenderingContext2D, v: ZoneView, strength: number) {
    if (v.shares.length === 0) return;
    const b = v.zone.box;
    const alpha = Math.min(1, (0.3 + 0.7 * v.fraction) * tintStrength(v.zone.kind) * strength + 0.05);

    if (v.shares.length === 1 || v.stripes.length === 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = v.shares[0].color;
      ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      ctx.globalAlpha = 1;
      return;
    }

    // diagonal owner stripes, widths proportional to cell counts
    const ux = Math.SQRT1_2;
    const uy = Math.SQRT1_2;
    const vx = -Math.SQRT1_2;
    const vy = Math.SQRT1_2;
    const corners = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of corners) {
      const s = x * ux + y * uy;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    const reach = Math.hypot(b.w, b.h);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const cs = cx * ux + cy * uy;
    ctx.globalAlpha = alpha;
    for (const stripe of v.stripes) {
      const s0 = lo + ((hi - lo) * stripe.offset) / 100;
      const s1 = lo + ((hi - lo) * (stripe.offset + stripe.pct)) / 100;
      ctx.fillStyle = stripe.color;
      ctx.beginPath();
      const p = (s: number, t: number) => [cx + (s - cs) * ux + t * vx, cy + (s - cs) * uy + t * vy];
      const pts = [p(s0, -reach), p(s1, -reach), p(s1, reach), p(s0, reach)];
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBrackets(ctx: CanvasRenderingContext2D, z: Zone, color: string, width: number, anim: number, low: boolean) {
    const b = z.box;
    const len = Math.max(9, Math.min(34, Math.min(b.w, b.h) * 0.16));
    const inset = 1.5;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    ctx.beginPath();
    const corners = [
      [b.x + inset, b.y + inset, 1, 1],
      [b.x + b.w - inset, b.y + inset, -1, 1],
      [b.x + inset, b.y + b.h - inset, 1, -1],
      [b.x + b.w - inset, b.y + b.h - inset, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.moveTo(x, y + len * dy);
      ctx.lineTo(x, y);
      ctx.lineTo(x + len * dx, y);
    }
    if (z.tier === 'CITADEL' && !low) {
      // a soft halo under the bright strokes
      ctx.globalAlpha = 0.2 + (anim ? 0.08 * Math.sin(anim * 2.4 + z.seed * 8) : 0);
      ctx.lineWidth = width * 3.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = width;
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBeacon(ctx: CanvasRenderingContext2D, f: Frame, v: ZoneView, accent: string) {
    const z = v.zone;
    const bx = z.anchor.x;
    const by = z.box.y + Math.min(30, z.box.h * 0.14);
    const flick = f.reduced ? 1 : 0.78 + 0.22 * Math.sin(f.anim * 2.4 + z.seed * 20);
    const beam = 120 + (f.reduced ? 0 : 8 * Math.sin(f.anim * 1.6 + z.seed * 5));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, by, 0, by - beam);
    g.addColorStop(0, rgba(accent, 0.5 * flick));
    g.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx - 8, by);
    ctx.lineTo(bx - 2.5, by - beam);
    ctx.lineTo(bx + 2.5, by - beam);
    ctx.lineTo(bx + 8, by);
    ctx.closePath();
    ctx.fill();
    const pool = ctx.createRadialGradient(bx, by, 0, bx, by, 26);
    pool.addColorStop(0, rgba(accent, 0.55 * flick));
    pool.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(bx - 26, by - 26, 52, 52);
    ctx.restore();
  }

  private drawPennant(ctx: CanvasRenderingContext2D, z: Zone, color: string, anim: number) {
    const x = z.box.x + z.box.w - 14;
    const y = z.box.y + 16;
    const wave = Math.sin(anim * 4 + z.seed * 10) * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - 0.8, y - 14, 2.2, 15);
    ctx.fillStyle = '#e8f1f8';
    ctx.fillRect(x - 1, y - 15, 1.8, 15);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + 0.8, y - 15);
    ctx.lineTo(x + 12, y - 11 + wave);
    ctx.lineTo(x + 0.8, y - 6.5);
    ctx.closePath();
    ctx.fill();
  }

  // ------------------------------------------------------------------- cells

  private drawCells(ctx: CanvasRenderingContext2D, f: Frame, v: ZoneView) {
    if (!v.cw || !v.ch) return;
    const b = v.zone.box;
    const h = Math.max(0, v.height);
    const rx0 = this.vx0 + OBL_X * h;
    const rx1 = this.vx1 + OBL_X * h;
    const ry0 = this.vy0 + h;
    const ry1 = this.vy1 + h;

    const c0 = Math.max(0, Math.floor((rx0 - b.x) / v.cw));
    const c1 = Math.floor((rx1 - b.x) / v.cw);
    const r0 = Math.max(0, Math.floor((ry0 - b.y) / v.ch));
    const r1 = Math.floor((ry1 - b.y) / v.ch);
    const gap = Math.min(0.9, v.cw * 0.045);

    ctx.save();
    ctx.clip(v.path);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = v.cellIndex.get(cellKey(row, col));
        if (!cell) continue;
        const x = b.x + col * v.cw;
        const y = b.y + row * v.ch;
        if (cell.ownerId) {
          ctx.globalAlpha = 0.82;
          ctx.fillStyle = cell.ownerColor;
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = (row + col) & 1 ? '#28313d' : '#2c3643';
        }
        ctx.fillRect(x + gap, y + gap, v.cw - gap * 2, v.ch - gap * 2);
      }
    }
    ctx.globalAlpha = 1;

    // freshly captured cells flare
    if (v.flashCells.size > 0) {
      for (const [id, fl] of v.flashCells) {
        const age = f.anim - fl.start;
        if (age > 1.6) {
          v.flashCells.delete(id);
          continue;
        }
        if (age < 0) continue;
        const k = 1 - age / 1.6;
        const x = b.x + fl.col * v.cw;
        const y = b.y + fl.row * v.ch;
        ctx.fillStyle = rgba('#ffffff', 0.85 * k * k);
        ctx.fillRect(x, y, v.cw, v.ch);
        const grow = (1 - k) * Math.max(v.cw, v.ch) * 1.2;
        ctx.strokeStyle = rgba('#ffffff', 0.8 * k);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - grow, y - grow, v.cw + grow * 2, v.ch + grow * 2);
      }
    }

    // hover outline
    const hc = f.hoverCell;
    if (hc && hc.zone === v.zone.index) {
      const x = b.x + hc.col * v.cw;
      const y = b.y + hc.row * v.ch;
      ctx.lineWidth = 2;
      ctx.strokeStyle = hc.challengeable ? PALETTE.danger : 'rgba(255,255,255,0.7)';
      ctx.shadowColor = hc.challengeable ? PALETTE.danger : '#ffffff';
      ctx.shadowBlur = 10;
      ctx.strokeRect(x + 0.5, y + 0.5, v.cw - 1, v.ch - 1);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ labels

  private textWidth(ctx: CanvasRenderingContext2D, text: string, size: number): number {
    const key = `${text}|${Math.round(size * 4)}`;
    let w = this.labelWidthCache.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.labelWidthCache.set(key, w);
    }
    return w;
  }

  /** Call after web fonts load so cached measurements are re-taken. */
  resetTextCache() {
    this.labelWidthCache.clear();
  }

  private drawLabels(ctx: CanvasRenderingContext2D, f: Frame) {
    const zoom = f.zoom;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (const idx of f.order) {
      const v = f.views[idx];
      const z = v.zone;
      if (!this.visible(z, 20)) continue;

      const h = liftedHeight(v);
      const ax = z.anchor.x - OBL_X * h;
      const ay = z.anchor.y - h;
      const text = v.label || v.territory?.name || z.id;

      const maxW = Math.max(36, z.labelWidth - 14);
      let fs = Math.min(26, Math.max(11, Math.sqrt(z.area) * 0.078));
      const minWorld = 8.5 / zoom;
      ctx.font = `700 ${fs}px ${FONT_DISPLAY}`;
      let shown = text;
      let tw = this.textWidth(ctx, shown, fs);
      const iconSize = fs * 0.95;

      if (tw + iconSize + 5 > maxW) {
        const shrink = (maxW - iconSize - 5) / tw;
        fs = Math.max(fs * shrink, Math.min(fs, minWorld));
        ctx.font = `700 ${fs}px ${FONT_DISPLAY}`;
        tw = this.textWidth(ctx, shown, fs);
        if (tw + 5 > maxW) {
          const per = tw / shown.length;
          const keep = Math.floor((maxW - 5) / per) - 1;
          if (keep < 3) continue;
          shown = shown.slice(0, keep).trimEnd() + '…';
          tw = this.textWidth(ctx, shown, fs);
        }
      }
      if (fs * zoom < 7.5) continue;

      const tier = TIER_STYLE[z.tier];
      const showIcon = tw + iconSize + 5 <= maxW + 8 && fs * zoom >= 9;
      const total = tw + (showIcon ? iconSize + 4 : 0);
      let x = ax - total / 2;
      // Zoomed-in zones and the one the avatar is standing on show their name
      // as a tag above the roof, so it never sits underneath the avatar.
      const underAvatar = f.currentZone === z.index && Math.hypot(f.player.x - z.anchor.x, f.player.y - z.anchor.y) < 70 + fs * 2.4;
      const detailTag = v.detail || underAvatar;
      const y = detailTag ? z.box.y - h - Math.max(10, 13 / zoom) : ay;
      if (detailTag) x = Math.max(x, z.box.x - OBL_X * h);

      const dim = v.discovered ? 1 : 0.62;

      if (detailTag) {
        const padX = fs * 0.5;
        const padY = fs * 0.42;
        ctx.fillStyle = 'rgba(4,10,18,0.78)';
        ctx.beginPath();
        roundedRect(ctx, x - padX, y - fs / 2 - padY, total + padX * 2, fs + padY * 2, fs * 0.5);
        ctx.fill();
        ctx.strokeStyle = rgba(tier.accent, 0.7);
        ctx.lineWidth = 1.2 / zoom;
        ctx.stroke();
      }

      if (showIcon) {
        ctx.save();
        ctx.translate(x, y - iconSize / 2);
        ctx.scale(iconSize / 24, iconSize / 24);
        ctx.fillStyle = rgba('#03080e', 0.8);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = rgba('#03080e', 0.85);
        const icon = iconPath(tier.icon);
        ctx.stroke(icon);
        ctx.fillStyle = rgba(tier.accent, dim);
        ctx.fill(icon);
        ctx.restore();
        x += iconSize + 4;
      }

      ctx.font = `700 ${fs}px ${FONT_DISPLAY}`;
      ctx.lineWidth = fs * 0.3;
      ctx.strokeStyle = 'rgba(3,8,14,0.9)';
      ctx.strokeText(shown, x, y);
      ctx.fillStyle = `rgba(238,246,252,${dim})`;
      ctx.fillText(shown, x, y);

      // little control meter beneath the name
      if (zoom >= 0.62 && v.ownedCount > 0 && !detailTag) {
        const mw = Math.min(110, Math.max(34, total));
        const mh = 3.4;
        const mx = ax - mw / 2;
        const my = y + fs * 0.78;
        ctx.fillStyle = 'rgba(2,6,10,0.65)';
        ctx.fillRect(mx - 1, my - 1, mw + 2, mh + 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(mx, my, mw, mh);
        const filled = mw * v.fraction;
        if (v.stripes.length > 1) {
          for (const s of v.stripes) {
            ctx.fillStyle = s.color;
            ctx.fillRect(mx + (filled * s.offset) / 100, my, (filled * s.pct) / 100, mh);
          }
        } else {
          ctx.fillStyle = v.shares[0].color;
          ctx.fillRect(mx, my, filled, mh);
        }
        if (v.contested && zoom >= 0.9) {
          ctx.font = `700 ${Math.max(8, fs * 0.62)}px ${FONT_MONO}`;
          ctx.fillStyle = PALETTE.danger;
          ctx.textAlign = 'center';
          ctx.fillText(`⚔ ${v.shares.length}`, ax, my + mh + fs * 0.62);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  // ------------------------------------------------------- route + avatar

  private drawRoute(ctx: CanvasRenderingContext2D, f: Frame) {
    const { route, destination, player } = f;
    const unit = 1 / f.zoom;

    if (route.length > 0 && destination) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * unit * Math.max(1, 0.8);
      ctx.setLineDash([0.1, 11 * unit]);
      ctx.lineDashOffset = f.reduced ? 0 : -f.anim * 30 * unit;
      ctx.strokeStyle = rgba(PALETTE.cyan, 0.9);
      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      for (let i = f.routeIndex; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y);
      ctx.stroke();
      ctx.restore();

      // destination marker
      const pulse = f.reduced ? 0.5 : (f.anim * 0.9) % 1;
      const r = 13 * unit;
      ctx.save();
      ctx.translate(destination.x, destination.y);
      ctx.scale(1, 0.62);
      ctx.strokeStyle = rgba(PALETTE.cyan, 0.9);
      ctx.lineWidth = 2.2 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(PALETTE.cyan, 1 - pulse);
      ctx.beginPath();
      ctx.arc(0, 0, r * (1 + pulse * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(destination.x, destination.y - 18 * unit - (f.reduced ? 0 : Math.sin(f.anim * 4) * 2.2 * unit));
      ctx.fillStyle = PALETTE.cyan;
      ctx.shadowColor = PALETTE.cyan;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, 9 * unit);
      ctx.lineTo(-6 * unit, 0);
      ctx.lineTo(0, -9 * unit);
      ctx.lineTo(6 * unit, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // pinned waypoint
    if (f.waypoint) {
      const w = f.waypoint;
      const bob = f.reduced ? 0 : Math.sin(f.anim * 3) * 3 * unit;
      ctx.save();
      ctx.translate(w.x, w.y - 40 * unit + bob);
      ctx.fillStyle = PALETTE.gold;
      ctx.shadowColor = PALETTE.gold;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(0, 18 * unit);
      ctx.bezierCurveTo(-14 * unit, 2 * unit, -12 * unit, -14 * unit, 0, -14 * unit);
      ctx.bezierCurveTo(12 * unit, -14 * unit, 14 * unit, 2 * unit, 0, 18 * unit);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05101a';
      ctx.beginPath();
      ctx.arc(0, -2 * unit, 4.6 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, f: Frame) {
    const p = f.player;
    const zoom = f.zoom;
    const unit = 1 / zoom;
    const r = (12 + 4 * Math.sqrt(zoom)) * unit;
    const moving = p.speed > 8;
    const bob = f.reduced ? 0 : moving ? Math.sin(p.phase * 2) * 2.2 * unit : Math.sin(f.anim * 2.4) * 1.6 * unit;

    // trail ghosts
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const t of p.trail) {
      const k = 1 - t.age / 0.7;
      if (k <= 0) continue;
      ctx.fillStyle = rgba(p.color, 0.22 * k);
      ctx.beginPath();
      ctx.arc(t.x - OBL_X * t.lift, t.y - t.lift, r * (0.35 + 0.5 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ground contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(p.x + 1.5 * unit, p.y + 2 * unit, r * 0.86, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    const sx = p.x - OBL_X * p.lift;
    const sy = p.y - p.lift - r * 0.7 + bob;

    // arrival / zone-enter ping on the ground
    if (p.ping > 0.01) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, 0.55);
      ctx.strokeStyle = rgba(p.color, p.ping);
      ctx.lineWidth = 3 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.2 + (1 - p.ping) * 4.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // aura
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
    aura.addColorStop(0, rgba(p.color, p.sprint ? 0.5 : 0.34));
    aura.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = aura;
    ctx.fillRect(sx - r * 3, sy - r * 3, r * 6, r * 6);
    ctx.restore();

    // body: hex badge
    ctx.save();
    ctx.translate(sx, sy);
    const hex = (rad: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    hex(r * 1.16);
    ctx.fillStyle = 'rgba(3,8,14,0.85)';
    ctx.fill();
    ctx.lineWidth = 2.2 * unit;
    ctx.strokeStyle = '#f4fbff';
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    hex(r * 0.9);
    const body = ctx.createLinearGradient(0, -r, 0, r);
    body.addColorStop(0, lighten(p.color, 0.35));
    body.addColorStop(1, darken(p.color, 0.25));
    ctx.fillStyle = body;
    ctx.fill();

    // heading chevron
    ctx.rotate(p.heading);
    ctx.fillStyle = '#04101a';
    ctx.beginPath();
    ctx.moveTo(r * 0.62, 0);
    ctx.lineTo(-r * 0.34, -r * 0.46);
    ctx.lineTo(-r * 0.1, 0);
    ctx.lineTo(-r * 0.34, r * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // name tag
    if (zoom > 0.38) {
      const fs = 11 * unit;
      ctx.font = `700 ${fs}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = 'YOU';
      const w = ctx.measureText(label).width + 12 * unit;
      const ty = sy - r * 1.9;
      ctx.fillStyle = 'rgba(3,9,16,0.82)';
      ctx.beginPath();
      roundedRect(ctx, sx - w / 2, ty - fs * 0.85, w, fs * 1.7, fs * 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.9);
      ctx.lineWidth = 1.2 * unit;
      ctx.stroke();
      ctx.fillStyle = '#eaf7ff';
      ctx.fillText(label, sx, ty + 0.5 * unit);
      ctx.textAlign = 'left';
    }
  }

  // -------------------------------------------------------------- atmosphere

  private drawClouds(ctx: CanvasRenderingContext2D, f: Frame) {
    if (f.zoom > 1.2) return; // close up they are just a smudge, and a costly one
    const W = this.campus.width;
    for (const c of this.clouds) {
      const span = W + c.r * 2 + 400;
      const x = f.reduced ? c.x % span : (c.x + f.anim * c.vx) % span;
      const cx = x - c.r - 200;
      if (cx + c.r < this.vx0 || cx - c.r > this.vx1 || c.y + c.r < this.vy0 || c.y - c.r > this.vy1) continue;
      const g = ctx.createRadialGradient(cx, c.y, 0, cx, c.y, c.r);
      g.addColorStop(0, 'rgba(1,4,9,0.2)');
      g.addColorStop(1, 'rgba(1,4,9,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - c.r, c.y - c.r, c.r * 2, c.r * 2);
    }
  }

  private drawMotes(ctx: CanvasRenderingContext2D, f: Frame) {
    if (f.reduced) return;
    const { vw, vh } = f;
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const x = (((m.fx * vw - f.cx * f.zoom * m.d + f.anim * m.vx) % vw) + vw) % vw;
      const y = (((m.fy * vh - f.cy * f.zoom * m.d - f.anim * 6) % vh) + vh) % vh;
      const tw = 0.5 + 0.5 * Math.sin(f.anim * 1.6 + m.ph);
      ctx.fillStyle = `rgba(120,230,255,${0.12 + 0.3 * tw})`;
      ctx.beginPath();
      ctx.arc(x, y, m.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Compass arrow toward a pinned waypoint that is off-screen. It orbits the
   * avatar on an ellipse (rather than hugging the screen edge) so it always
   * lands in clear space instead of under the HUD panels.
   */
  private drawWaypointArrow(ctx: CanvasRenderingContext2D, f: Frame) {
    const w = f.waypoint;
    if (!w) return;
    const { vw, vh, zoom } = f;
    const sx = vw / 2 + (w.x - f.cx) * zoom;
    const sy = vh / 2 + (w.y - f.cy) * zoom;
    if (sx > 30 && sx < vw - 30 && sy > 30 && sy < vh - 30) return; // the in-world pin is visible

    const ang = Math.atan2(sy - vh / 2, sx - vw / 2);
    const px = vw / 2 + Math.cos(ang) * vw * 0.27;
    const py = vh / 2 + Math.sin(ang) * vh * 0.3;
    const dist = Math.round(Math.hypot(w.x - f.player.x, w.y - f.player.y) * 0.5);
    const pulse = f.reduced ? 0 : Math.sin(f.anim * 4) * 2;

    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = 'rgba(4,10,18,0.82)';
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(ang);
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.moveTo(9 + pulse, 0);
    ctx.lineTo(-4, -7);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = `700 12px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `${dist} m`;
    const tw = ctx.measureText(label).width + 12;
    const lx = px - Math.cos(ang) * 38;
    const ly = py - Math.sin(ang) * 30;
    ctx.fillStyle = 'rgba(4,10,18,0.82)';
    ctx.beginPath();
    roundedRect(ctx, lx - tw / 2, ly - 10, tw, 20, 10);
    ctx.fill();
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(label, lx, ly + 0.5);
    ctx.textAlign = 'left';
  }

  // ----------------------------------------------------------------- minimap

  /** Scale + offset used by drawMinimap, so clicks can be mapped back to the world. */
  minimapTransform(w: number, h: number) {
    const pad = 8;
    const span = SLAB_MARGIN;
    const s = Math.min((w - pad * 2) / (this.campus.width + span * 2), (h - pad * 2) / (this.campus.height + span * 2));
    const ox = (w - (this.campus.width + span * 2) * s) / 2 + span * s;
    const oy = (h - (this.campus.height + span * 2) * s) / 2 + span * s;
    return { s, ox, oy };
  }

  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, f: Frame) {
    const { s, ox, oy } = this.minimapTransform(w, h);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.fillStyle = '#0a1522';
    ctx.fill(this.slabPath);
    ctx.lineWidth = 1.4 / s;
    ctx.strokeStyle = rgba(PALETTE.cyan, 0.5);
    ctx.stroke(this.slabPath);

    for (const idx of f.order) {
      const v = f.views[idx];
      const base = baseRoof(v.zone.kind, v.zone.tier);
      const color = v.topColor && v.fraction > 0 ? mix(base, v.topColor, 0.35 + 0.65 * v.fraction) : mix(base, '#0a1522', 0.15);
      ctx.fillStyle = v.discovered ? color : mix(color, '#050b12', 0.55);
      ctx.fill(v.path);
      if (v.contested) {
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = rgba(PALETTE.danger, 0.9);
        ctx.stroke(v.path);
      }
      if (f.currentZone === v.zone.index || v.select > 0.5) {
        ctx.lineWidth = 2.2 / s;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke(v.path);
      }
      if (v.capturedAt >= 0) {
        const age = f.anim - v.capturedAt;
        if (age >= 0 && age < 2.4) {
          ctx.beginPath();
          ctx.arc(v.zone.anchor.x, v.zone.anchor.y, (14 + age * 60) , 0, Math.PI * 2);
          ctx.lineWidth = 2 / s;
          ctx.strokeStyle = rgba(PALETTE.cyan, 1 - age / 2.4);
          ctx.stroke();
        }
      }
    }

    // viewport rectangle
    const vwW = f.vw / f.zoom;
    const vhH = f.vh / f.zoom;
    ctx.lineWidth = 1.4 / s;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeRect(f.cx - vwW / 2, f.cy - vhH / 2, vwW, vhH);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(f.cx - vwW / 2, f.cy - vhH / 2, vwW, vhH);

    if (f.destination) {
      ctx.fillStyle = PALETTE.cyan;
      ctx.beginPath();
      ctx.arc(f.destination.x, f.destination.y, 6 / s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (f.waypoint) {
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(f.waypoint.x, f.waypoint.y, 7 / s, 0, Math.PI * 2);
      ctx.fill();
    }

    const pulse = f.reduced ? 0.5 : (f.anim * 0.8) % 1;
    ctx.strokeStyle = rgba(f.player.color, 1 - pulse);
    ctx.lineWidth = 2 / s;
    ctx.beginPath();
    ctx.arc(f.player.x, f.player.y, (6 + pulse * 18) / s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = f.player.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 / s;
    ctx.beginPath();
    ctx.arc(f.player.x, f.player.y, 5 / s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

