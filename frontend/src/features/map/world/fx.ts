import { rgba } from './color';
import { FONT_DISPLAY } from './theme';

// Lightweight world-space effects: sparks, dust, shockwave rings and
// floating text. Plain arrays with swap-removal - there are never more than
// a few hundred alive, so pooling would be noise.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  glow: boolean;
  drag: number;
  grow: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  /** Flatten vertically to read as a ring lying on the ground. */
  squash: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

const MAX_PARTICLES = 420;

export class Fx {
  /** Reduced-motion: sparks and dust are skipped; rings and text still give feedback. */
  reduced = false;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];

  get active() {
    return this.particles.length + this.rings.length + this.texts.length > 0;
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
  }

  private add(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  dust(x: number, y: number, vx: number, vy: number, color = '#9fb4c6') {
    if (this.reduced) return;
    this.add({
      x,
      y,
      vx: vx + (Math.random() - 0.5) * 18,
      vy: vy + (Math.random() - 0.5) * 18,
      life: 0,
      max: 0.5 + Math.random() * 0.35,
      size: 1.6 + Math.random() * 2.4,
      color,
      glow: false,
      drag: 3.2,
      grow: 1.6,
    });
  }

  spark(x: number, y: number, color: string, speed = 160) {
    if (this.reduced) return;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.35 + Math.random() * 0.65);
    this.add({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0,
      max: 0.6 + Math.random() * 0.6,
      size: 1.8 + Math.random() * 2.6,
      color,
      glow: true,
      drag: 2.4,
      grow: 0,
    });
  }

  burst(x: number, y: number, color: string, count = 26, speed = 220) {
    for (let i = 0; i < count; i++) this.spark(x, y, color, speed);
  }

  ring(x: number, y: number, color: string, r1 = 120, max = 0.9, width = 3, r0 = 6) {
    this.rings.push({ x, y, r0, r1, life: 0, max, color, width, squash: 0.62 });
  }

  text(x: number, y: number, text: string, color: string, size = 18, max = 1.6) {
    this.texts.push({ x, y, text, color, life: 0, max, size });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life += dt;
      if (this.rings[i].life >= this.rings[i].max) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].life += dt;
      if (this.texts[i].life >= this.texts[i].max) this.texts.splice(i, 1);
    }
  }

  /** Draws in world space. `zoom` keeps sizes readable when zoomed out. */
  draw(ctx: CanvasRenderingContext2D, zoom: number) {
    const sizeScale = Math.max(1, 0.9 / zoom);

    for (const r of this.rings) {
      const t = r.life / r.max;
      const e = 1 - Math.pow(1 - t, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.scale(1, r.squash);
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(0.5, r.width * (1 - t) * sizeScale);
      ctx.strokeStyle = rgba(r.color, (1 - t) * 0.9);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of this.particles) {
      const t = p.life / p.max;
      const a = (1 - t) * (p.glow ? 1 : 0.55);
      const s = (p.size + p.grow * t * 3) * sizeScale;
      if (p.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(p.color, a * 0.35);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const f of this.texts) {
      const t = f.life / f.max;
      const rise = (1 - Math.pow(1 - t, 2)) * 46;
      const size = f.size * sizeScale;
      ctx.save();
      ctx.font = `700 ${size}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.28;
      const a = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45);
      ctx.strokeStyle = `rgba(3,8,14,${0.85 * a})`;
      ctx.strokeText(f.text, f.x, f.y - rise);
      ctx.fillStyle = rgba(f.color, a);
      ctx.fillText(f.text, f.x, f.y - rise);
      ctx.restore();
    }
  }
}
