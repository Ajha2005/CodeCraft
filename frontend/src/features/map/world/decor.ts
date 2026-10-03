import { mix } from './color';
import { PALETTE, type ZoneKind } from './theme';
import type { ZoneView } from './scene';
import type { Pt } from './geometry';

// Roof art. Everything is drawn in zone-local world coordinates, already
// clipped to the zone outline by the caller. Repeating textures (windows,
// awnings, mown grass, ...) are rendered once into small tiles and reused as
// canvas patterns, so a hostel with 300 windows costs one fill, not 300.

export function mulberry32(seed: number) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base roof color for an *unclaimed* zone of this kind. */
export function baseRoof(kind: ZoneKind): string {
  switch (kind) {
    case 'field':
      return '#15402c';
    case 'track':
      return '#29382f';
    case 'court':
      return '#1c3855';
    case 'parking':
      return '#1a232f';
    case 'water':
      return '#0b4560';
    case 'forest':
      return '#0b3322';
    case 'plaza':
      return '#2a3441';
    case 'gate':
      return '#262f3b';
    case 'medical':
      return '#2d3945';
    case 'construction':
      return '#33302b';
    default:
      return PALETTE.stone;
  }
}

/** How strongly the owner's color should cover the terrain art. */
export function tintStrength(kind: ZoneKind): number {
  switch (kind) {
    case 'water':
    case 'forest':
    case 'field':
    case 'track':
    case 'court':
      return 0.6;
    case 'parking':
    case 'plaza':
    case 'gate':
      return 0.74;
    default:
      return 0.9;
  }
}

type TileDraw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

export class DecorKit {
  private patterns = new Map<string, CanvasPattern>();
  private forestTex = new Map<string, HTMLCanvasElement>();

  private pattern(ctx: CanvasRenderingContext2D, key: string, wu: number, hu: number, ppu: number, draw: TileDraw): CanvasPattern {
    const hit = this.patterns.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(wu * ppu);
    canvas.height = Math.ceil(hu * ppu);
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    c.scale(ppu, ppu);
    draw(c, wu, hu);
    const p = ctx.createPattern(canvas, 'repeat') as CanvasPattern;
    p.setTransform(new DOMMatrix().scale(1 / ppu));
    this.patterns.set(key, p);
    return p;
  }

  private fillPattern(ctx: CanvasRenderingContext2D, view: ZoneView, p: CanvasPattern, alpha: number) {
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = p;
    ctx.fill(view.path);
    ctx.globalAlpha /= alpha || 1;
  }

  /** Paint the terrain/props for one zone. `t` is seconds, for animation. */
  draw(ctx: CanvasRenderingContext2D, view: ZoneView, t: number, zoom: number) {
    const z = view.zone;
    const b = z.box;
    const rng = mulberry32(z.seed);
    const fine = zoom > 0.34;

    switch (z.kind) {
      case 'hostel': {
        const p = this.pattern(ctx, 'win-hostel', 64, 56, 2, (c) => {
          const r = mulberry32(7);
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) {
              const lit = r() < 0.34;
              c.fillStyle = lit ? 'rgba(255,214,140,0.85)' : 'rgba(6,14,24,0.55)';
              c.fillRect(i * 16 + 3, j * 14 + 3, 10, 8);
            }
          }
        });
        this.fillPattern(ctx, view, p, fine ? 0.55 : 0.3);
        this.roofline(ctx, view, 9, 'rgba(255,255,255,0.08)');
        this.rooftopUnits(ctx, view, rng, 3);
        break;
      }
      case 'academic': {
        const p = this.pattern(ctx, 'win-academic', 96, 48, 2, (c) => {
          const r = mulberry32(11);
          for (let j = 0; j < 2; j++) {
            for (let i = 0; i < 3; i++) {
              c.fillStyle = r() < 0.4 ? 'rgba(150,225,255,0.7)' : 'rgba(40,90,125,0.55)';
              c.fillRect(i * 32 + 4, j * 24 + 5, 24, 13);
            }
          }
        });
        this.fillPattern(ctx, view, p, fine ? 0.5 : 0.28);
        this.roofline(ctx, view, 11, 'rgba(255,255,255,0.1)');
        this.rooftopUnits(ctx, view, rng, 4);
        break;
      }
      case 'residence': {
        const p = this.pattern(ctx, 'houses', 48, 48, 2, (c) => {
          c.fillStyle = 'rgba(255,255,255,0.11)';
          c.fillRect(6, 8, 36, 30);
          c.fillStyle = 'rgba(0,0,0,0.28)';
          c.fillRect(6, 22, 36, 2);
          c.fillStyle = 'rgba(255,200,140,0.6)';
          c.fillRect(30, 12, 5, 5);
        });
        this.fillPattern(ctx, view, p, 0.9);
        break;
      }
      case 'market': {
        const p = this.pattern(ctx, 'awning', 28, 28, 3, (c) => {
          c.fillStyle = 'rgba(239,68,68,0.34)';
          c.fillRect(0, 0, 14, 28);
          c.fillStyle = 'rgba(255,255,255,0.24)';
          c.fillRect(14, 0, 14, 28);
          c.fillStyle = 'rgba(0,0,0,0.22)';
          c.fillRect(0, 24, 28, 4);
        });
        this.fillPattern(ctx, view, p, fine ? 0.85 : 0.5);
        break;
      }
      case 'plaza': {
        const p = this.pattern(ctx, 'paving', 24, 24, 2, (c) => {
          c.strokeStyle = 'rgba(255,255,255,0.07)';
          c.lineWidth = 1;
          c.strokeRect(0.5, 0.5, 23, 23);
        });
        this.fillPattern(ctx, view, p, 1);
        // a central fountain
        const cx = z.anchor.x;
        const cy = z.anchor.y;
        const r = Math.min(b.w, b.h) * 0.16;
        ctx.strokeStyle = 'rgba(120,210,255,0.4)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const wave = fine ? ((t * 0.5 + k / 3) % 1) : 0.5;
          ctx.globalAlpha = 1 - wave;
          ctx.beginPath();
          ctx.arc(cx, cy, r * (0.35 + wave * 0.85), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(80,180,230,0.28)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'field': {
        const p = this.pattern(ctx, 'mow', 56, 56, 1.5, (c) => {
          c.fillStyle = 'rgba(255,255,255,0.07)';
          c.fillRect(0, 0, 56, 28);
          c.fillStyle = 'rgba(0,0,0,0.12)';
          c.fillRect(0, 28, 56, 28);
        });
        this.fillPattern(ctx, view, p, 1);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, b.w * 0.42, b.h * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, b.w * 0.27, b.h * 0.27, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(214,190,140,0.55)';
        ctx.fillRect(cx - 7, cy - b.h * 0.2, 14, b.h * 0.4);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.strokeRect(cx - 7, cy - b.h * 0.2, 14, b.h * 0.4);
        break;
      }
      case 'track': {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        // green infield
        const inner = Math.min(b.w, b.h) * 0.2;
        ctx.fillStyle = 'rgba(30,110,70,0.5)';
        this.roundRect(ctx, cx - b.w * 0.2, cy - b.h * 0.3, b.w * 0.4, b.h * 0.6, inner);
        ctx.fill();
        for (let lane = 0; lane < 5; lane++) {
          const inset = 14 + lane * 11;
          ctx.strokeStyle = lane === 0 || lane === 4 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.26)';
          ctx.lineWidth = lane === 0 || lane === 4 ? 1.4 : 0.9;
          this.roundRect(ctx, b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2, Math.min(b.w, b.h) / 2 - inset);
          ctx.stroke();
        }
        break;
      }
      case 'court': {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.4;
        const m = 14;
        ctx.strokeRect(b.x + m, b.y + m, b.w - m * 2, b.h - m * 2);
        ctx.beginPath();
        ctx.moveTo(b.x + b.w / 2, b.y + m);
        ctx.lineTo(b.x + b.w / 2, b.y + b.h - m);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeRect(b.x + m, b.y + b.h / 2 - b.h * 0.18, b.w * 0.16, b.h * 0.36);
        ctx.strokeRect(b.x + b.w - m - b.w * 0.16, b.y + b.h / 2 - b.h * 0.18, b.w * 0.16, b.h * 0.36);
        break;
      }
      case 'parking': {
        ctx.strokeStyle = 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 1.2;
        const vertical = b.h >= b.w;
        const step = 17;
        ctx.beginPath();
        if (vertical) {
          for (let y = b.y + 14; y < b.y + b.h - 6; y += step) {
            ctx.moveTo(b.x + 6, y);
            ctx.lineTo(b.x + b.w * 0.36, y);
            ctx.moveTo(b.x + b.w * 0.64, y);
            ctx.lineTo(b.x + b.w - 6, y);
          }
        } else {
          for (let x = b.x + 14; x < b.x + b.w - 6; x += step) {
            ctx.moveTo(x, b.y + 6);
            ctx.lineTo(x, b.y + b.h * 0.36);
            ctx.moveTo(x, b.y + b.h * 0.64);
            ctx.lineTo(x, b.y + b.h - 6);
          }
        }
        ctx.stroke();
        break;
      }
      case 'gate': {
        ctx.strokeStyle = 'rgba(255,214,102,0.34)';
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 12]);
        ctx.beginPath();
        ctx.moveTo(b.x + 14, z.anchor.y);
        ctx.lineTo(b.x + b.w - 14, z.anchor.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // gate arch
        const ax = z.anchor.x;
        const ay = z.anchor.y;
        ctx.strokeStyle = 'rgba(190,230,255,0.55)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax - 38, ay + 24);
        ctx.lineTo(ax - 38, ay - 6);
        ctx.arc(ax, ay - 6, 38, Math.PI, 0);
        ctx.lineTo(ax + 38, ay + 24);
        ctx.stroke();
        break;
      }
      case 'forest': {
        const tex = this.forest(view);
        ctx.drawImage(tex.canvas, tex.x, tex.y, tex.w, tex.h);
        break;
      }
      case 'water': {
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
        g.addColorStop(0, '#0b5b7a');
        g.addColorStop(1, '#073a56');
        ctx.fillStyle = g;
        ctx.fill(view.path);
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 5; k++) {
          const yy = b.y + ((k + 0.5) * b.h) / 5;
          ctx.strokeStyle = `rgba(150,225,255,${0.14 + 0.1 * Math.sin(t * 1.4 + k)})`;
          ctx.beginPath();
          for (let x = b.x; x <= b.x + b.w; x += 6) {
            const y = yy + Math.sin(x * 0.07 + t * 1.8 + k * 1.3) * 2.6;
            if (x === b.x) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        if (fine) {
          for (let k = 0; k < 6; k++) {
            const sx = b.x + rng() * b.w;
            const sy = b.y + rng() * b.h;
            const tw = 0.5 + 0.5 * Math.sin(t * 2.3 + k * 2.1);
            ctx.fillStyle = `rgba(255,255,255,${0.18 + 0.5 * tw})`;
            ctx.fillRect(sx - 1, sy - 1, 2.4, 2.4);
          }
        }
        break;
      }
      case 'medical': {
        const s = Math.min(b.w, b.h) * 0.2;
        ctx.fillStyle = 'rgba(248,113,113,0.55)';
        ctx.fillRect(z.anchor.x - s * 0.34, z.anchor.y - s, s * 0.68, s * 2);
        ctx.fillRect(z.anchor.x - s, z.anchor.y - s * 0.34, s * 2, s * 0.68);
        this.roofline(ctx, view, 9, 'rgba(255,255,255,0.1)');
        break;
      }
      case 'construction': {
        const p = this.pattern(ctx, 'hazard', 40, 40, 1.6, (c) => {
          c.fillStyle = 'rgba(251,191,36,0.34)';
          c.beginPath();
          c.moveTo(0, 20);
          c.lineTo(20, 0);
          c.lineTo(40, 0);
          c.lineTo(0, 40);
          c.closePath();
          c.fill();
          c.beginPath();
          c.moveTo(40, 20);
          c.lineTo(20, 40);
          c.lineTo(40, 40);
          c.closePath();
          c.fill();
        });
        this.fillPattern(ctx, view, p, 1);
        this.roofline(ctx, view, 12, 'rgba(251,191,36,0.4)');
        break;
      }
      case 'auditorium': {
        const cx = z.anchor.x;
        const cy = b.y + b.h * 0.78;
        ctx.strokeStyle = 'rgba(190,225,255,0.22)';
        ctx.lineWidth = 2.2;
        const maxR = Math.min(b.w, b.h) * 0.9;
        for (let r = maxR * 0.28; r < maxR; r += maxR * 0.13) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,230,160,0.4)';
        ctx.fillRect(cx - maxR * 0.16, cy - maxR * 0.1, maxR * 0.32, maxR * 0.06);
        this.roofline(ctx, view, 8, 'rgba(255,255,255,0.09)');
        break;
      }
      default: {
        const p = this.pattern(ctx, 'panels', 24, 24, 2, (c) => {
          c.strokeStyle = 'rgba(255,255,255,0.08)';
          c.lineWidth = 1;
          c.strokeRect(0.5, 0.5, 23, 23);
        });
        this.fillPattern(ctx, view, p, 1);
        this.rooftopUnits(ctx, view, rng, 2);
      }
    }
  }

  private roofline(ctx: CanvasRenderingContext2D, view: ZoneView, inset: number, color: string) {
    const b = view.zone.box;
    if (view.zone.poly.length > 6) return; // irregular outlines: skip the parapet
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
  }

  /** A few HVAC boxes / skylights so big roofs do not read as empty slabs. */
  private rooftopUnits(ctx: CanvasRenderingContext2D, view: ZoneView, rng: () => number, count: number) {
    const b = view.zone.box;
    if (b.w < 90 || b.h < 70 || view.zone.poly.length > 6) return;
    for (let i = 0; i < count; i++) {
      const w = 14 + rng() * 22;
      const h = 10 + rng() * 14;
      const x = b.x + 18 + rng() * Math.max(1, b.w - 36 - w);
      const y = b.y + 18 + rng() * Math.max(1, b.h - 36 - h);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 3, y + 3, w, h);
      ctx.fillStyle = 'rgba(210,225,240,0.28)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, w, 2);
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** The forest is baked once into a texture: hundreds of trees, one drawImage. */
  private forest(view: ZoneView) {
    const z = view.zone;
    const key = z.id;
    const ppu = 1.5;
    const pad = 12;
    const x = z.box.x - pad;
    const y = z.box.y - pad;
    const w = z.box.w + pad * 2;
    const h = z.box.h + pad * 2;
    let canvas = this.forestTex.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * ppu);
      canvas.height = Math.ceil(h * ppu);
      const c = canvas.getContext('2d') as CanvasRenderingContext2D;
      c.scale(ppu, ppu);
      c.translate(-x, -y);
      const rng = mulberry32(z.seed + 0.123);
      const pts: Pt[] = [];
      const step = 17;
      for (let gy = z.box.y; gy < z.box.y + z.box.h; gy += step) {
        for (let gx = z.box.x; gx < z.box.x + z.box.w; gx += step) {
          const px = gx + rng() * step;
          const py = gy + rng() * step;
          if (insidePoly(px, py, z.poly)) pts.push({ x: px, y: py });
        }
      }
      pts.sort((a, b) => a.y - b.y);
      for (const p of pts) {
        const r = 7 + rng() * 6;
        const tone = rng();
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath();
        c.ellipse(p.x + r * 0.35, p.y + r * 0.45, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = mix('#0f4d33', '#2f8f4f', tone * 0.7);
        c.beginPath();
        c.arc(p.x, p.y - r * 0.25, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = mix('#1b6a45', '#7ad08a', 0.2 + tone * 0.35);
        c.beginPath();
        c.arc(p.x - r * 0.28, p.y - r * 0.52, r * 0.52, 0, Math.PI * 2);
        c.fill();
      }
      this.forestTex.set(key, canvas);
    }
    return { canvas, x, y, w, h };
  }
}

function insidePoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}
