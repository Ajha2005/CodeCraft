// The one place that says how many cells the map has.
//
// Change TOTAL_CELLS, bump TARGET_GRID_VERSION, and run `prisma/regrid.ts`:
// the split across zones, the per-zone grids and the carrying over of
// ownership are all derived from these two numbers and the zone outlines in
// frontend/src/assets/campus-map.svg.

/** Cells on the whole campus map. Split across the zones in proportion to their area. */
export const TOTAL_CELLS = 1000;

/** Grid generation written by the current layout. 1 = the original ~80-unit grid (554 cells). */
export const TARGET_GRID_VERSION = 2;

/** Every zone keeps at least this many cells, however small it is, so it can always be captured. */
export const MIN_CELLS_PER_ZONE = 1;
