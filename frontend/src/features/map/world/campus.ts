import campusSvg from '../../../assets/campus-map.svg?raw';
import { parseCampus, type Campus } from './geometry';
import { NavGrid, type LaneMark } from './nav';

// The campus never changes at runtime, so parse it (and build the walkability
// grid) once per page load and share it between the engine and the HUD.

export interface World {
  campus: Campus;
  nav: NavGrid;
  lanes: LaneMark[];
}

let cached: World | null = null;

export function getWorld(): World {
  if (!cached) {
    const campus = parseCampus(campusSvg);
    const nav = new NavGrid(campus);
    cached = { campus, nav, lanes: nav.laneMarks() };
  }
  return cached;
}

/** Spawn point: the Main Gate, where every commander enters campus. */
export function spawnPoint(world: World): { x: number; y: number } {
  const gate = world.campus.byId.get('main-gate');
  const p = gate ? gate.anchor : { x: world.campus.width / 2, y: world.campus.height / 2 };
  return world.nav.nearestWalkable(p.x, p.y);
}

/** 8 columns (A-H) by 4 rows (1-4) over the campus, like a paper map's grid. */
export function sectorOf(campus: Campus, x: number, y: number): string {
  const col = Math.max(0, Math.min(7, Math.floor((x / campus.width) * 8)));
  const row = Math.max(0, Math.min(3, Math.floor((y / campus.height) * 4)));
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** World units to a friendlier "metres" figure for the HUD. */
export function toMeters(units: number): number {
  return Math.round(units * 0.5);
}
