import type { TerritoryDto } from '../../../types/territory';
import type { TerritoryCellDto } from '../../../lib/api';
import { colorForUser } from '../../../lib/playerColor';
import { Fx } from './fx';
import { distanceToPolygonEdge, type Pt, type Zone } from './geometry';
import { sectorOf, spawnPoint, toMeters, type World } from './campus';
import { WorldRenderer, type Frame, type HoverCellRef, type PlayerRender } from './render';
import { OBL_X, applySceneData, createZoneView, pickCell, pickZone, type ZoneView } from './scene';
import { TIER_STYLE } from './theme';

// The map "game engine": owns the canvas, the loop, the camera, the avatar
// and all input. React only sees it through a small imperative API, a few
// event callbacks and a throttled stats snapshot (see EngineStats).

const WALK_SPEED = 250;
const SPRINT_SPEED = 520;
const MIN_ZOOM_FLOOR = 0.1;
const MAX_ZOOM = 6;
const GLOBAL_DETAIL_ENTER = 1.5;
const GLOBAL_DETAIL_EXIT = 1.25;
const LOCAL_DETAIL_ENTER = 0.8;
const LOCAL_DETAIL_EXIT = 0.66;
const WORLD_SLACK = 44;

export interface HoverInfo {
  zoneId: string;
  cell: TerritoryCellDto | null;
  challengeable: boolean;
  /** The player name under the pointer (clicking it opens their profile), if any. */
  name: string | null;
  /** Pointer position in viewport coordinates when the hover began. */
  clientX: number;
  clientY: number;
}

export interface EngineStats {
  zoom: number;
  /** Zoom relative to "whole campus in view" - what the HUD shows as a percentage. */
  zoomPct: number;
  px: number;
  py: number;
  heading: number;
  speed: number;
  sprinting: boolean;
  following: boolean;
  traveling: boolean;
  sector: string;
  zoneId: string | null;
  waypointMeters: number | null;
  destinationMeters: number | null;
  /** How many zones this commander has explored so far. */
  explored: number;
}

export interface EngineHandlers {
  /** `traveling` is true while an auto-run route is active. */
  onZoneChange?: (zone: Zone | null, previous: Zone | null, traveling: boolean) => void;
  onHover?: (info: HoverInfo | null) => void;
  onSelect?: (zoneId: string | null) => void;
  onCellChallenge?: (cell: TerritoryCellDto, zone: Zone) => void;
  /** A player's name written on the map was clicked. */
  onNameClick?: (username: string) => void;
  onDiscover?: (zone: Zone, discovered: number, total: number) => void;
  onTravel?: (event: 'start' | 'arrive' | 'cancel', zone: Zone | null) => void;
  onCapture?: (event: { zone: Zone; cell: TerritoryCellDto; byMe: boolean }) => void;
  onPlayerMoved?: (pos: Pt) => void;
  onInteract?: () => void;
}

interface Anchor {
  wx: number;
  wy: number;
  sx: number;
  sy: number;
  until: number;
}

interface PointerState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export class MapEngine {
  readonly views: ZoneView[];
  readonly order: number[];
  /** `views` in draw order (back to front), for hit-testing front to back. */
  private readonly orderedViews: ZoneView[];

  private handlers: EngineHandlers = {};
  private canvas: HTMLCanvasElement | null = null;
  private host: HTMLElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private renderer: WorldRenderer | null = null;
  private miniCanvas: HTMLCanvasElement | null = null;
  private miniCtx: CanvasRenderingContext2D | null = null;
  private resizeObs: ResizeObserver | null = null;
  private cleanups: (() => void)[] = [];

  private vw = 1;
  private vh = 1;
  private dpr = 1;
  private raf = 0;
  private lastTs = 0;
  private lastMini = 0;
  private lastStatsEmit = 0;
  private lastRender = 0;
  private lastActivity = 0;
  private lastPersist = 0;
  private clock = 0;
  private anim = 0;
  private reduced = false;
  private running = false;

  // camera
  private cam = { x: 0, y: 0, zoom: 0.5 };
  private tgt = { x: 0, y: 0, zoom: 0.5 };
  private viewZoom = 0.5;
  private minZoom = 0.3;
  private fitZoom = 0.4;
  private defaultZoom = 0.9;
  private following = true;
  private anchor: Anchor | null = null;
  private fling = { vx: 0, vy: 0 };
  private introUntil = 0;
  private shakeAmp = 0;
  private sprintAmt = 0;

  // adaptive quality: watch the real interval between animation frames and
  // shed purely decorative effects (and pixel density) if it stays slow
  private frameMs = 16;
  private failures = 0;
  private slowRun = 0;
  private fastRun = 0;
  private lowFx = false;
  private upgradeAt = 0;
  private upgradeBackoff = 25;

  // player
  private player = { x: 0, y: 0, vx: 0, vy: 0, heading: 0, lift: 0, phase: 0 };
  private playerRender: PlayerRender;
  private route: Pt[] = [];
  private routeSuffix: number[] = [];
  private routeIndex = 0;
  private routeSpeed = 420;
  private destination: Pt | null = null;
  private destinationZone: Zone | null = null;
  private stepAcc = 0;
  private trailAcc = 0;
  private pingTimer = 0;

  // input
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private stickSprint = false;
  private inputEnabled = true;
  private pointers = new Map<number, PointerState>();
  private pinch: { dist: number } | null = null;
  private gestureUsed = false;
  private velSamples: { t: number; dx: number; dy: number }[] = [];

  // world state
  private meColor = '#22d3ee';
  private currentIdx = -1;
  private hoverIdx = -1;
  private hoverCell: HoverCellRef | null = null;
  private hoverCellId: string | null = null;
  private hoverName: string | null = null;
  private lastClient = { x: 0, y: 0 };
  /** Last mouse position over the canvas (CSS px), so hover can follow the camera. */
  private pointerLocal: { x: number; y: number } | null = null;
  private cameraMoved = false;
  private lastHoverCheck = 0;
  private highlightIdx = -1;
  private selectedIdx = -1;
  private waypointIdx = -1;
  private fogEnabled = false;
  private discovered = new Set<string>();
  private hasData = false;
  private pendingIntro = true;
  private skipIntro = false;

  // stats store (useSyncExternalStore friendly)
  private stats: EngineStats;
  private listeners = new Set<() => void>();

  private fx = new Fx();
  private frame: Frame;

  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.views = world.campus.zones.map(createZoneView);
    this.order = world.campus.zones
      .map((z) => z.index)
      .sort((a, b) => {
        const za = world.campus.zones[a].box;
        const zb = world.campus.zones[b].box;
        return za.y + za.h - (zb.y + zb.h) || za.x - zb.x;
      });

    this.orderedViews = this.order.map((i) => this.views[i]);

    const start = spawnPoint(world);
    this.player.x = start.x;
    this.player.y = start.y;

    this.playerRender = {
      x: start.x,
      y: start.y,
      heading: 0,
      speed: 0,
      lift: 0,
      phase: 0,
      sprint: false,
      color: this.meColor,
      trail: [],
      ping: 0,
    };

    this.stats = this.buildStats();
    this.frame = {
      anim: 0,
      dt: 0,
      cx: 0,
      cy: 0,
      zoom: 1,
      vw: 1,
      vh: 1,
      dpr: 1,
      shakeX: 0,
      shakeY: 0,
      views: this.views,
      order: this.order,
      hoverZone: -1,
      selectZone: -1,
      currentZone: -1,
      waypointZone: -1,
      hoverCell: null,
      player: this.playerRender,
      route: this.route,
      routeIndex: 0,
      destination: null,
      waypoint: null,
      fx: this.fx,
      meColor: this.meColor,
      reduced: false,
      lowFx: false,
    };
  }

  get campus() {
    return this.world.campus;
  }

  // =========================================================== lifecycle

  attach(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.canvas = canvas;
    this.host = host;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.renderer = new WorldRenderer(this.world.campus, this.world.lanes);
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.fx.reduced = this.reduced;

    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);

    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e));
    on(canvas, 'pointermove', (e) => this.onPointerMove(e));
    on(canvas, 'pointerup', (e) => this.onPointerUp(e));
    on(canvas, 'pointercancel', (e) => this.onPointerUp(e));
    on(canvas, 'pointerleave', () => {
      this.pointerLocal = null;
      this.setHover(-1, null);
    });
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'dblclick', (e) => this.onDoubleClick(e));
    on(canvas, 'contextmenu', (e) => this.onContextMenu(e));

    const kd = (e: KeyboardEvent) => this.onKeyDown(e);
    const ku = (e: KeyboardEvent) => this.onKeyUp(e);
    const blur = () => {
      this.keys.clear();
      this.stick.x = this.stick.y = 0;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });

    // Re-measure labels once the display font arrives.
    void document.fonts?.ready.then(() => this.renderer?.resetTextCache());

    this.running = true;
    this.lastTs = 0;
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  detach() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.pointers.clear();
    this.keys.clear();
    this.canvas = null;
    this.ctx = null;
    this.host = null;
    this.renderer = null;
    this.miniCanvas = null;
    this.miniCtx = null;
  }

  setMinimap(canvas: HTMLCanvasElement | null) {
    this.miniCanvas = canvas;
    this.miniCtx = canvas ? canvas.getContext('2d') : null;
  }

  setHandlers(h: EngineHandlers) {
    this.handlers = h;
  }

  private resize() {
    if (!this.canvas || !this.host) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.lowFx ? 1.25 : 2);
    this.vw = w;
    this.vh = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const { campus } = this.world;
    const spanX = campus.width + WORLD_SLACK * 2;
    const spanY = campus.height + WORLD_SLACK * 2;
    this.fitZoom = Math.min(w / spanX, h / spanY);
    this.minZoom = Math.max(MIN_ZOOM_FLOOR, this.fitZoom * 0.9);
    this.defaultZoom = clamp(w / 1800, 0.55, 1.0);

    if (this.pendingIntro && this.hasData) this.startIntro();
    else {
      this.tgt.zoom = clamp(this.tgt.zoom, this.minZoom, MAX_ZOOM);
      this.cam.zoom = clamp(this.cam.zoom, this.minZoom, MAX_ZOOM);
    }
    this.touch();
  }

  // ================================================================ data

  /** Who is playing; call before the first setData. */
  setUser(opts: { userId: string | null; startPos?: Pt | null; explored?: string[] | null; skipIntro?: boolean }) {
    this.skipIntro = !!opts.skipIntro;
    this.meColor = colorForUser(opts.userId);
    this.playerRender.color = this.meColor;
    this.frame.meColor = this.meColor;

    if (opts.startPos) {
      const p = this.world.nav.nearestWalkable(opts.startPos.x, opts.startPos.y);
      this.player.x = p.x;
      this.player.y = p.y;
      this.playerRender.x = p.x;
      this.playerRender.y = p.y;
    }
    if (opts.explored) {
      this.fogEnabled = true;
      this.discovered = new Set(opts.explored);
      this.refreshDiscovered();
    }
  }

  private refreshDiscovered() {
    for (const v of this.views) {
      v.discovered = !this.fogEnabled || this.discovered.has(v.zone.id) || v.mineCount > 0;
    }
  }

  setData(territories: Record<string, TerritoryDto>, cellsByTerritory: Record<string, TerritoryCellDto[]>) {
    const first = !this.hasData;
    const change = applySceneData(this.world.campus, this.views, territories, cellsByTerritory, this.anim, first);
    for (const v of this.views) v.label = v.territory?.name ?? v.zone.id;

    // Zones you hold cells in are never "unexplored".
    if (this.fogEnabled) {
      for (const v of this.views) if (v.mineCount > 0) this.discovered.add(v.zone.id);
      this.refreshDiscovered();
    }

    let bursts = 0;
    for (const c of change.captured) {
      c.view.capturedAt = this.anim;
      this.handlers.onCapture?.({ zone: c.view.zone, cell: c.cell, byMe: c.byMe });
      if (bursts++ >= 8) continue;
      const { dx, dy } = { dx: -OBL_X * c.view.height, dy: -c.view.height };
      const b = c.view.zone.box;
      const cx = b.x + (c.cell.col + 0.5) * c.view.cw + dx;
      const cy = b.y + (c.cell.row + 0.5) * c.view.ch + dy;
      const color = c.cell.ownerColor || '#22d3ee';
      this.fx.burst(cx, cy, color, c.byMe ? 34 : 20, c.byMe ? 260 : 190);
      this.fx.ring(cx, cy, color, c.byMe ? 150 : 110, 1, 3.5);
      this.fx.ring(cx, cy, '#ffffff', c.byMe ? 90 : 60, 0.7, 2);
      if (c.byMe) this.fx.text(cx, cy - 8, '+1 CELL', '#ffffff', 18);
    }
    if (change.captured.length > 0) {
      const near = change.captured.some((c) => {
        const a = c.view.zone.anchor;
        return Math.hypot(a.x - this.player.x, a.y - this.player.y) < 700;
      });
      if (near) this.shake(this.reduced ? 0 : 5);
    }

    if (first) {
      this.hasData = true;
      if (this.pendingIntro && this.canvas) this.startIntro();
    }
    this.touch();
  }

  private startIntro() {
    this.pendingIntro = false;
    const { campus } = this.world;
    this.following = true;
    this.tgt.zoom = this.defaultZoom;
    if (this.skipIntro || this.reduced) {
      // Returning visitors (and reduced-motion users) land right on their commander.
      this.cam.x = this.player.x;
      this.cam.y = this.player.y;
      this.cam.zoom = this.defaultZoom;
      this.introUntil = 0;
    } else {
      this.cam.x = campus.width / 2;
      this.cam.y = campus.height / 2;
      this.cam.zoom = this.fitZoom;
      this.introUntil = this.clock + 2.6;
    }
    this.syncCurrentZone(true);
    this.touch();
  }

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.stick.x = this.stick.y = 0;
    }
  }

  // ============================================================ commands

  private zoneByIdOrNull(id: string | null): ZoneView | null {
    if (!id) return null;
    const zone = this.world.campus.byId.get(id);
    return zone ? this.views[zone.index] : null;
  }

  selectZone(id: string | null) {
    const v = this.zoneByIdOrNull(id);
    this.selectedIdx = v ? v.zone.index : -1;
    this.handlers.onSelect?.(v ? v.zone.id : null);
    this.touch();
  }

  setHighlight(id: string | null) {
    this.highlightIdx = this.zoneByIdOrNull(id)?.zone.index ?? -1;
    this.touch();
  }

  setWaypoint(id: string | null) {
    this.waypointIdx = this.zoneByIdOrNull(id)?.zone.index ?? -1;
    this.touch();
  }

  travelToZone(id: string, opts?: { boost?: boolean }) {
    const v = this.zoneByIdOrNull(id);
    if (!v) return;
    this.travelTo(v.zone.anchor.x, v.zone.anchor.y, v.zone, opts?.boost);
  }

  travelToPoint(x: number, y: number) {
    this.travelTo(x, y, null, false);
  }

  private travelTo(x: number, y: number, zone: Zone | null, boost = false) {
    const goal = this.world.nav.nearestWalkable(x, y);
    const path = this.world.nav.findPath({ x: this.player.x, y: this.player.y }, goal);
    if (path.length < 2) return;

    this.route = path;
    this.frame.route = path;
    this.routeIndex = 1;
    this.routeSuffix = new Array(path.length).fill(0);
    for (let i = path.length - 2; i >= 0; i--) {
      this.routeSuffix[i] = this.routeSuffix[i + 1] + Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    }
    const total = this.routeSuffix[0];
    this.routeSpeed = clamp(380 + total * 0.22, 380, boost ? 980 : 760);
    this.destination = goal;
    this.destinationZone = zone ?? this.zoneAt(goal.x, goal.y);
    this.following = true;
    this.anchor = null;
    this.handlers.onTravel?.('start', this.destinationZone);
    this.touch();
  }

  cancelTravel() {
    if (this.route.length === 0) return;
    this.clearRoute();
    this.handlers.onTravel?.('cancel', null);
    this.touch();
  }

  private clearRoute() {
    this.route = [];
    this.frame.route = this.route;
    this.routeIndex = 0;
    this.destination = null;
    this.destinationZone = null;
  }

  private zoneAt(x: number, y: number): Zone | null {
    const i = this.world.nav.zoneIndexAt(x, y);
    return i >= 0 ? this.world.campus.zones[i] : null;
  }

  recenter() {
    this.setFollowing(true);
    this.anchor = null;
    this.fling.vx = this.fling.vy = 0;
    this.touch();
  }

  private setFollowing(v: boolean) {
    if (v) this.anchor = null; // a zoom anchor only makes sense for a free camera
    if (this.following === v) return;
    this.following = v;
    this.touch();
  }

  focusZone(id: string) {
    const v = this.zoneByIdOrNull(id);
    if (!v) return;
    const b = v.zone.box;
    this.setFollowing(false);
    this.anchor = null;
    this.tgt.x = b.x + b.w / 2 - OBL_X * v.height * 0.5;
    this.tgt.y = b.y + b.h / 2 - v.height * 0.5;
    this.tgt.zoom = clamp(Math.min((this.vw * 0.6) / b.w, (this.vh * 0.6) / b.h), 0.9, 3.4);
    this.touch();
  }

  /** Toggle between the normal view and a close look at the current/selected zone. */
  diveToggle() {
    const idx = this.selectedIdx >= 0 ? this.selectedIdx : this.currentIdx;
    const diving = this.tgt.zoom >= 1.45;
    if (diving || idx < 0) {
      this.tgt.zoom = this.defaultZoom;
      this.recenter();
    } else {
      this.focusZone(this.views[idx].zone.id);
    }
  }

  overview() {
    const { campus } = this.world;
    this.setFollowing(false);
    this.anchor = null;
    this.tgt.x = campus.width / 2;
    this.tgt.y = campus.height / 2;
    this.tgt.zoom = this.fitZoom;
    this.touch();
  }

  zoomBy(factor: number) {
    this.tgt.zoom = clamp(this.tgt.zoom * factor, this.minZoom, MAX_ZOOM);
    this.touch();
  }

  zoomReset() {
    this.tgt.zoom = this.defaultZoom;
    this.recenter();
  }

  shake(amp: number) {
    if (this.reduced) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.touch();
  }

  setVirtualStick(x: number, y: number, sprint = false) {
    this.stick.x = x;
    this.stick.y = y;
    this.stickSprint = sprint;
    this.touch();
  }

  /** Map a point on the minimap canvas back to world coordinates. */
  minimapToWorld(px: number, py: number, w: number, h: number): Pt | null {
    if (!this.renderer) return null;
    const { s, ox, oy } = this.renderer.minimapTransform(w, h);
    return { x: (px - ox) / s, y: (py - oy) / s };
  }

  // ========================================================== stats store

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getStats = () => this.stats;

  private buildStats(): EngineStats {
    const { campus } = this.world;
    const p = this.player;
    const speed = Math.hypot(p.vx, p.vy);
    const wp = this.waypointIdx >= 0 ? campus.zones[this.waypointIdx] : null;
    return {
      zoom: this.viewZoom,
      zoomPct: Math.round((this.viewZoom / Math.max(this.fitZoom, 0.0001)) * 100),
      px: p.x,
      py: p.y,
      heading: this.playerRender.heading,
      speed,
      sprinting: this.playerRender.sprint,
      following: this.following,
      traveling: this.route.length > 0,
      sector: sectorOf(campus, p.x, p.y),
      zoneId: this.currentIdx >= 0 ? campus.zones[this.currentIdx].id : null,
      waypointMeters: wp ? toMeters(Math.hypot(wp.anchor.x - p.x, wp.anchor.y - p.y)) : null,
      destinationMeters: this.destination ? toMeters(Math.hypot(this.destination.x - p.x, this.destination.y - p.y)) : null,
      explored: this.discovered.size,
    };
  }

  private emitStats(now: number) {
    if (now - this.lastStatsEmit < 100) return;
    this.lastStatsEmit = now;
    const next = this.buildStats();
    const prev = this.stats;
    const same =
      Math.abs(next.zoomPct - prev.zoomPct) < 1 &&
      Math.round(next.px / 4) === Math.round(prev.px / 4) &&
      Math.round(next.py / 4) === Math.round(prev.py / 4) &&
      next.sprinting === prev.sprinting &&
      next.following === prev.following &&
      next.traveling === prev.traveling &&
      next.zoneId === prev.zoneId &&
      next.waypointMeters === prev.waypointMeters &&
      next.destinationMeters === prev.destinationMeters &&
      next.explored === prev.explored &&
      Math.abs(next.heading - prev.heading) < 0.05 &&
      Math.abs(next.speed - prev.speed) < 12;
    if (same) return;
    this.stats = next;
    for (const fn of this.listeners) fn();
  }

  // ============================================================== input

  private touch() {
    this.lastActivity = performance.now();
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.running || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    if (code === 'Escape') {
      this.cancelTravel();
      return;
    }
    if (!this.inputEnabled) return;

    // A focused button/link keeps Space and Enter, so the HUD stays operable
    // from the keyboard; walking and camera keys still work.
    if ((code === 'Space' || code === 'Enter') && e.target instanceof HTMLElement && e.target.closest('button, a, summary, [role="button"]')) return;

    if (movement.includes(code) || code === 'ShiftLeft' || code === 'ShiftRight') {
      if (movement.includes(code)) e.preventDefault();
      if (!this.keys.has(code) && movement.includes(code)) {
        this.cancelTravelSilently();
        this.setFollowing(true);
      }
      this.keys.add(code);
      this.touch();
      return;
    }
    if (e.repeat) return;
    switch (code) {
      case 'Space':
        e.preventDefault();
        this.diveToggle();
        break;
      case 'KeyE':
      case 'Enter':
        this.handlers.onInteract?.();
        break;
      case 'KeyC':
        this.recenter();
        break;
      case 'KeyO':
        this.overview();
        break;
      case 'Equal':
      case 'NumpadAdd':
        this.zoomBy(1.3);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this.zoomBy(1 / 1.3);
        break;
      case 'Digit0':
        this.zoomReset();
        break;
      default:
    }
  }

  private cancelTravelSilently() {
    if (this.route.length === 0) return;
    this.clearRoute();
    this.handlers.onTravel?.('cancel', null);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private local(e: PointerEvent | MouseEvent | WheelEvent) {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toWorld(sx: number, sy: number): Pt {
    return { x: this.cam.x + (sx - this.vw / 2) / this.viewZoom, y: this.cam.y + (sy - this.vh / 2) / this.viewZoom };
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.canvas) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, button: e.button, moved: false });
    this.fling.vx = this.fling.vy = 0;
    this.velSamples = [];
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      this.gestureUsed = true;
    }
    this.touch();
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.canvas) return;
    const { x, y } = this.local(e);
    const p = this.pointers.get(e.pointerId);

    if (!p) {
      if (e.pointerType === 'mouse') {
        this.pointerLocal = { x, y };
        this.updateHover(x, y);
      }
      return;
    }

    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;

    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch.dist > 8 && dist > 8) this.zoomAt(mx, my, dist / this.pinch.dist, true);
      this.pinch.dist = dist;
      this.setFollowing(false);
      return;
    }

    if (!p.moved && Math.hypot(x - p.sx, y - p.sy) > 6) {
      p.moved = true;
      this.setFollowing(false);
      this.anchor = null;
      this.canvas.style.cursor = 'grabbing';
      this.setHover(-1, null);
    }
    if (p.moved) {
      const wx = dx / this.viewZoom;
      const wy = dy / this.viewZoom;
      this.cam.x -= wx;
      this.cam.y -= wy;
      this.tgt.x = this.cam.x;
      this.tgt.y = this.cam.y;
      const now = performance.now();
      this.velSamples.push({ t: now, dx: wx, dy: wy });
      while (this.velSamples.length > 0 && now - this.velSamples[0].t > 110) this.velSamples.shift();
      this.touch();
    }
  }

  private onPointerUp(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;

    if (this.pointers.size === 0) {
      const wasGesture = this.gestureUsed;
      this.gestureUsed = false;
      if (this.canvas) this.canvas.style.cursor = this.hoverIdx >= 0 ? 'pointer' : 'default';

      if (p.moved) {
        const now = performance.now();
        const samples = this.velSamples.filter((s) => now - s.t < 110);
        if (samples.length >= 2) {
          const span = Math.max(0.016, (samples[samples.length - 1].t - samples[0].t) / 1000);
          const vx = samples.reduce((s, q) => s + q.dx, 0) / span;
          const vy = samples.reduce((s, q) => s + q.dy, 0) / span;
          if (Math.hypot(vx, vy) * this.viewZoom > 120) {
            this.fling.vx = -vx;
            this.fling.vy = -vy;
          }
        }
      } else if (!wasGesture && e.type === 'pointerup') {
        this.handleClick(p.x, p.y);
      }
    }
  }

  private handleClick(sx: number, sy: number) {
    const w = this.toWorld(sx, sy);
    // A player's name sits on top of their cells: it is tested first, so
    // clicking it opens their profile instead of challenging them.
    const named = this.renderer?.nameAt(w.x, w.y);
    if (named) {
      this.handlers.onNameClick?.(named.username);
      return;
    }
    const view = pickZone(this.zoneViewsInOrder(), w.x, w.y);
    if (view) {
      if (view.detail) {
        const cell = pickCell(view, w.x, w.y);
        if (cell && cell.ownerId && !cell.isMe) {
          this.handlers.onCellChallenge?.(cell, view.zone);
          return;
        }
      }
      this.selectZone(view.zone.id);
    } else {
      this.selectZone(null);
      this.travelToPoint(w.x, w.y);
    }
  }

  private onDoubleClick(e: MouseEvent) {
    const { x, y } = this.local(e);
    const w = this.toWorld(x, y);
    this.travelToPoint(w.x, w.y);
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const { x, y } = this.local(e);
    const w = this.toWorld(x, y);
    this.travelToPoint(w.x, w.y);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const k = e.ctrlKey ? 0.011 : 0.0017;
    const { x, y } = this.local(e);
    this.zoomAt(x, y, Math.exp(-e.deltaY * unit * k), false);
  }

  private zoomAt(sx: number, sy: number, factor: number, force: boolean) {
    const z1 = clamp(this.tgt.zoom * factor, this.minZoom, MAX_ZOOM);
    if (z1 === this.tgt.zoom) return;
    this.tgt.zoom = z1;
    if (this.following && !force) return; // keep the avatar centred while zooming
    const w = this.toWorld(sx, sy);
    this.anchor = { wx: w.x, wy: w.y, sx, sy, until: this.clock + 0.45 };
    this.touch();
  }

  private zoneViewsInOrder(): ZoneView[] {
    return this.orderedViews;
  }

  private updateHover(sx: number, sy: number) {
    const rect = this.canvas?.getBoundingClientRect();
    this.lastClient = { x: (rect?.left ?? 0) + sx, y: (rect?.top ?? 0) + sy };
    const w = this.toWorld(sx, sy);
    const named = this.renderer?.nameAt(w.x, w.y);
    if (named) {
      this.setHover(named.zone, null, named.username);
      return;
    }
    const view = pickZone(this.zoneViewsInOrder(), w.x, w.y);
    if (!view) {
      this.setHover(-1, null);
      return;
    }
    let cell: TerritoryCellDto | null = null;
    if (view.detail) cell = pickCell(view, w.x, w.y);
    this.setHover(view.zone.index, cell);
  }

  private setHover(idx: number, cell: TerritoryCellDto | null, name: string | null = null) {
    if (idx === this.hoverIdx && (cell?.id ?? null) === this.hoverCellId && name === this.hoverName) return;
    this.hoverIdx = idx;
    this.hoverCellId = cell?.id ?? null;
    this.hoverName = name;
    const challengeable = !!cell && !!cell.ownerId && !cell.isMe;
    this.hoverCell = cell && idx >= 0 ? { zone: idx, row: cell.row, col: cell.col, challengeable } : null;
    if (this.canvas && this.pointers.size === 0) this.canvas.style.cursor = idx >= 0 ? (challengeable ? 'crosshair' : 'pointer') : 'default';
    this.handlers.onHover?.(
      idx >= 0
        ? { zoneId: this.world.campus.zones[idx].id, cell, challengeable, name, clientX: this.lastClient.x, clientY: this.lastClient.y }
        : null,
    );
    this.touch();
  }

  // =============================================================== loop

  private loop(ts: number) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));

    const quietFor = performance.now() - this.lastActivity;
    const idle = quietFor > 2200 && !this.fx.active && this.route.length === 0;
    // ~20fps once nothing is happening, ~11fps after a long quiet spell
    if (idle && ts - this.lastRender < (quietFor > 15000 ? 88 : 45)) return;
    this.lastRender = ts;

    const rawGap = this.lastTs ? ts - this.lastTs : 16;
    if (!idle) this.adaptQuality(rawGap);
    const dt = this.lastTs ? clamp(rawGap / 1000, 0, 0.05) : 0.016;
    this.lastTs = ts;
    try {
      this.update(dt);
      this.render();
      this.emitStats(ts);
      this.failures = 0;
    } catch (err) {
      // One bad frame must not spam the console or take the page down; a
      // persistent failure stops the loop instead of burning CPU.
      if (this.failures === 0) console.error('[map] frame failed', err);
      if (++this.failures > 120) {
        this.running = false;
        console.error('[map] giving up after repeated frame failures');
      }
    }
  }

  private update(dt: number) {
    this.clock += dt;
    if (!this.reduced) this.anim += dt;
    const p = this.player;
    const nav = this.world.nav;

    // ---- intent
    let ix = 0;
    let iy = 0;
    let sprint = false;
    if (this.inputEnabled) {
      const k = this.keys;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iy += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) iy -= 1;
      ix += this.stick.x;
      iy += this.stick.y;
      sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.stickSprint;
    }
    const mag = Math.hypot(ix, iy);
    if (mag > 1) {
      ix /= mag;
      iy /= mag;
    }
    const manual = mag > 0.08;

    let tvx = 0;
    let tvy = 0;
    let accel = 10;
    if (manual) {
      if (this.route.length > 0) this.cancelTravelSilently();
      const speed = (sprint ? SPRINT_SPEED : WALK_SPEED) * Math.min(1, Math.max(mag, 0.35));
      tvx = ix * speed;
      tvy = iy * speed;
    } else if (this.route.length > 0) {
      const wp = this.route[this.routeIndex];
      const dx = wp.x - p.x;
      const dy = wp.y - p.y;
      const d = Math.hypot(dx, dy);
      const remaining = d + (this.routeSuffix[this.routeIndex] ?? 0);
      const speed = this.routeSpeed * clamp(remaining / 240, 0.22, 1);
      const reach = Math.max(9, Math.hypot(p.vx, p.vy) * dt * 1.4);
      if (d <= reach) {
        this.routeIndex++;
        if (this.routeIndex >= this.route.length) this.arrive();
      } else {
        tvx = (dx / d) * speed;
        tvy = (dy / d) * speed;
        accel = 7;
      }
    }

    const k = 1 - Math.exp(-dt * accel);
    p.vx += (tvx - p.vx) * k;
    p.vy += (tvy - p.vy) * k;
    const speed = Math.hypot(p.vx, p.vy);

    // ---- move with wall sliding
    if (speed > 0.5) {
      const dirx = p.vx / speed;
      const diry = p.vy / speed;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const probe = 7;
      const free = (x: number, y: number) => nav.isWalkable(x + dirx * probe, y + diry * probe) && nav.isWalkable(x, y);
      if (free(nx, ny)) {
        p.x = nx;
        p.y = ny;
      } else if (free(nx, p.y)) {
        p.x = nx;
        p.vy *= 0.3;
      } else if (free(p.x, ny)) {
        p.y = ny;
        p.vx *= 0.3;
      } else {
        p.vx = p.vy = 0;
        if (this.route.length > 0) this.arrive();
      }
    }

    const moving = speed > 12;
    const sprinting = moving && (sprint || (this.route.length > 0 && speed > 450));
    if (speed > 15) {
      const target = Math.atan2(p.vy, p.vx);
      p.heading += wrapAngle(target - p.heading) * (1 - Math.exp(-dt * 14));
    }
    p.phase += speed * dt * 0.045;

    // footsteps + trail
    if (moving) {
      this.stepAcc += speed * dt;
      if (this.stepAcc > (sprinting ? 15 : 24)) {
        this.stepAcc = 0;
        this.fx.dust(p.x - (p.vx / speed) * 7, p.y + 2, -p.vx * 0.1, -p.vy * 0.1);
      }
      this.trailAcc += speed * dt;
      if (this.trailAcc > 7 && !this.reduced) {
        this.trailAcc = 0;
        this.playerRender.trail.push({ x: p.x, y: p.y, lift: p.lift, age: 0 });
      }
    }
    const trail = this.playerRender.trail;
    for (const t of trail) t.age += dt;
    while (trail.length > 0 && trail[0].age > 0.7) trail.shift();

    // ---- zone + elevation
    this.syncCurrentZone(false);
    let targetLift = 0;
    const cur = this.currentIdx >= 0 ? this.views[this.currentIdx] : null;
    if (cur && cur.height > 0) {
      const depth = distanceToPolygonEdge(p.x, p.y, cur.zone.poly);
      targetLift = cur.height * smooth01(depth / 14);
    }
    p.lift += (targetLift - p.lift) * (1 - Math.exp(-dt * 16));

    this.pingTimer = Math.max(0, this.pingTimer - dt * 1.4);

    const pr = this.playerRender;
    pr.x = p.x;
    pr.y = p.y;
    pr.heading = p.heading;
    pr.speed = speed;
    pr.lift = p.lift;
    pr.phase = p.phase;
    pr.sprint = sprinting;
    pr.ping = this.pingTimer;

    if (moving && this.clock - this.lastPersist > 1.2) {
      this.lastPersist = this.clock;
      this.handlers.onPlayerMoved?.({ x: p.x, y: p.y });
    }
    if (moving) this.touch();

    this.updateCamera(dt, speed, sprinting);

    // ---- zone animation channels
    const kh = 1 - Math.exp(-dt * 14);
    const ks = 1 - Math.exp(-dt * 9);
    for (const v of this.views) {
      const hoverTarget = v.zone.index === this.hoverIdx || v.zone.index === this.highlightIdx ? 1 : 0;
      v.hover += (hoverTarget - v.hover) * kh;
      v.select += ((v.zone.index === this.selectedIdx ? 1 : 0) - v.select) * ks;
      const selectTarget = v.zone.index === this.selectedIdx ? 1 : 0;
      if (Math.abs(v.hover - hoverTarget) > 0.01 || Math.abs(v.select - selectTarget) > 0.01) this.touch();

      // cell detail with hysteresis; per-zone so only relevant zones pay
      const cellPx = Math.min(v.cw, v.ch) * this.viewZoom;
      const local = v.zone.index === this.currentIdx || v.zone.index === this.selectedIdx;
      const globalOn = this.viewZoom >= (v.detail ? GLOBAL_DETAIL_EXIT : GLOBAL_DETAIL_ENTER);
      const localOn = local && this.viewZoom >= (v.detail ? LOCAL_DETAIL_EXIT : LOCAL_DETAIL_ENTER);
      v.detail = v.cells.length > 0 && cellPx >= 4 && (globalOn || localOn);
    }

    this.fx.update(dt);

    // The world slid under a motionless cursor (zoom, follow-cam, fling):
    // re-pick what is under it, at most ~12x a second.
    if (this.cameraMoved && this.pointerLocal && this.pointers.size === 0 && this.clock - this.lastHoverCheck > 0.08) {
      this.cameraMoved = false;
      this.lastHoverCheck = this.clock;
      this.updateHover(this.pointerLocal.x, this.pointerLocal.y);
    }
  }

  private arrive() {
    const zone = this.destinationZone;
    this.clearRoute();
    this.pingTimer = 1;
    const p = this.player;
    this.fx.ring(p.x, p.y, this.meColor, 90, 0.9, 3);
    this.handlers.onTravel?.('arrive', zone);
  }

  private syncCurrentZone(silent: boolean) {
    const idx = this.world.nav.zoneIndexAt(this.player.x, this.player.y);
    if (idx === this.currentIdx) return;
    const prev = this.currentIdx >= 0 ? this.world.campus.zones[this.currentIdx] : null;
    this.currentIdx = idx;
    const zone = idx >= 0 ? this.world.campus.zones[idx] : null;

    if (silent) {
      // Spawning inside a zone counts as having been there, without fanfare.
      if (zone && this.fogEnabled) {
        this.discovered.add(zone.id);
        this.views[zone.index].discovered = true;
      }
      return;
    }

    this.pingTimer = 1;
    this.handlers.onZoneChange?.(zone, prev, this.route.length > 0);

    // Crossing a border is already marked by the avatar's own ping; only a
    // first discovery gets sparks (the page adds the title card).
    if (zone) {
      const view = this.views[zone.index];
      if (!this.discovered.has(zone.id) && this.fogEnabled) {
        this.discovered.add(zone.id);
        view.discovered = true;
        this.fx.burst(zone.anchor.x, zone.anchor.y - view.height, TIER_STYLE[zone.tier].accent, 18, 200);
        this.handlers.onDiscover?.(zone, this.discovered.size, this.world.campus.zones.length);
      }
    }
  }

  /** Explored zones, so the page can persist them. */
  getExplored(): string[] {
    return [...this.discovered];
  }

  getPlayerPos(): Pt {
    return { x: this.player.x, y: this.player.y };
  }

  private updateCamera(dt: number, speed: number, sprinting: boolean) {
    const p = this.player;
    const intro = this.clock < this.introUntil;
    const kPos = this.reduced ? 30 : intro ? 2.1 : 6.2;
    const kZoom = this.reduced ? 30 : intro ? 2.3 : 9;

    if (this.following) {
      const look = 0.26;
      this.tgt.x = p.x - OBL_X * p.lift + clamp(p.vx * look, -120, 120);
      this.tgt.y = p.y - p.lift + clamp(p.vy * look, -120, 120);
    } else if (Math.abs(this.fling.vx) + Math.abs(this.fling.vy) > 6) {
      this.tgt.x += this.fling.vx * dt;
      this.tgt.y += this.fling.vy * dt;
      this.cam.x = this.tgt.x;
      this.cam.y = this.tgt.y;
      const decay = Math.exp(-dt * 3.4);
      this.fling.vx *= decay;
      this.fling.vy *= decay;
      this.touch();
      this.cameraMoved = true;
    }

    const lz = Math.log(this.cam.zoom);
    const lt = Math.log(clamp(this.tgt.zoom, this.minZoom, MAX_ZOOM));
    this.cam.zoom = Math.exp(lz + (lt - lz) * (1 - Math.exp(-dt * kZoom)));
    if (Math.abs(lt - lz) > 0.002) {
      this.touch();
      this.cameraMoved = true;
    }

    if (this.anchor && !this.following) {
      const a = this.anchor;
      this.cam.x = a.wx - (a.sx - this.vw / 2) / this.cam.zoom;
      this.cam.y = a.wy - (a.sy - this.vh / 2) / this.cam.zoom;
      this.tgt.x = this.cam.x;
      this.tgt.y = this.cam.y;
      if (this.clock > a.until && Math.abs(lt - lz) < 0.003) this.anchor = null;
    } else {
      const kp = 1 - Math.exp(-dt * kPos);
      const dx = this.tgt.x - this.cam.x;
      const dy = this.tgt.y - this.cam.y;
      this.cam.x += dx * kp;
      this.cam.y += dy * kp;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) {
        this.touch();
        this.cameraMoved = true;
      }
    }

    // FOV-style kick while sprinting
    this.sprintAmt += ((sprinting && speed > 300 ? 1 : 0) - this.sprintAmt) * (1 - Math.exp(-dt * 4));
    this.viewZoom = this.cam.zoom * (1 - (this.reduced ? 0 : 0.06) * this.sprintAmt);

    this.clampCamera();
  }

  private clampCamera() {
    const { campus } = this.world;
    const halfW = this.vw / (2 * this.viewZoom);
    const halfH = this.vh / (2 * this.viewZoom);
    const slackX = halfW * 0.12;
    const slackY = halfH * 0.12;
    const minX = -WORLD_SLACK;
    const maxX = campus.width + WORLD_SLACK;
    const minY = -WORLD_SLACK;
    const maxY = campus.height + WORLD_SLACK;
    const fit = (v: number, lo: number, hi: number, half: number, slack: number) =>
      hi - lo <= half * 2 ? (lo + hi) / 2 : clamp(v, lo + half - slack, hi - half + slack);
    this.cam.x = fit(this.cam.x, minX, maxX, halfW, slackX);
    this.cam.y = fit(this.cam.y, minY, maxY, halfH, slackY);
    this.tgt.x = fit(this.tgt.x, minX, maxX, halfW, slackX);
    this.tgt.y = fit(this.tgt.y, minY, maxY, halfH, slackY);
  }

  // ============================================================== render

  /**
   * The time `draw()` itself takes is useless here - canvas work is rasterized
   * asynchronously - so we watch the real gap between animation frames instead.
   * Sustained slowness while the player is actively moving switches to low-fx;
   * we only try to come back after a growing cooldown.
   */
  private adaptQuality(frameGapMs: number) {
    if (frameGapMs > 400) return; // tab was hidden / throttled, not a slow device
    this.frameMs += (frameGapMs - this.frameMs) * 0.08;
    if (!this.lowFx) {
      this.slowRun = this.frameMs > 34 ? this.slowRun + 1 : 0;
      if (this.slowRun > 50) {
        this.lowFx = true;
        this.slowRun = 0;
        this.upgradeAt = this.clock + this.upgradeBackoff;
        this.resize(); // lower pixel density too
      }
    } else if (this.clock > this.upgradeAt) {
      this.fastRun = this.frameMs < 21 ? this.fastRun + 1 : 0;
      if (this.fastRun > 150) {
        this.lowFx = false;
        this.fastRun = 0;
        this.upgradeBackoff = Math.min(this.upgradeBackoff * 2, 200);
        this.frameMs = 20; // judge the restored quality on fresh frames
        this.resize();
      }
    }
  }

  private render() {
    const ctx = this.ctx;
    const renderer = this.renderer;
    if (!ctx || !renderer) return;

    const f = this.frame;
    f.anim = this.anim;
    f.dt = 0.016;
    f.cx = this.cam.x;
    f.cy = this.cam.y;
    f.zoom = this.viewZoom;
    f.vw = this.vw;
    f.vh = this.vh;
    f.dpr = this.dpr;
    this.shakeAmp *= Math.exp(-0.016 * 6);
    if (this.shakeAmp < 0.05) this.shakeAmp = 0;
    f.shakeX = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    f.shakeY = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    f.hoverZone = this.hoverIdx;
    f.selectZone = this.selectedIdx;
    f.currentZone = this.currentIdx;
    f.waypointZone = this.waypointIdx;
    f.hoverCell = this.hoverCell;
    f.routeIndex = this.routeIndex;
    f.destination = this.destination;
    f.waypoint = this.waypointIdx >= 0 ? this.world.campus.zones[this.waypointIdx].anchor : null;
    f.reduced = this.reduced;
    f.lowFx = this.lowFx;

    renderer.draw(ctx, f);

    const now = performance.now();
    if (this.miniCanvas && this.miniCtx && now - this.lastMini > 66) {
      this.lastMini = now;
      const mw = this.miniCanvas.clientWidth;
      const mh = this.miniCanvas.clientHeight;
      const mdpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.miniCanvas.width !== Math.round(mw * mdpr)) {
        this.miniCanvas.width = Math.round(mw * mdpr);
        this.miniCanvas.height = Math.round(mh * mdpr);
      }
      renderer.drawMinimap(this.miniCtx, mw, mh, mdpr, f);
    }
  }
}
