// The version 1 map grid, exactly as prisma/generate-grid.ts lays it out
// (80-unit squares over a rough bounding box, kept when the centre is inside
// the outline). Tests use it to build the "before" state of a regrid. The
// 554-cell total below is the count the live map had, so a drift in this copy
// shows up as a failing test.
import { isInside } from 'point-in-svg-polygon';

export interface LegacyCell {
  zoneId: string;
  row: number;
  col: number;
}

export const LEGACY_CELL_SIZE = 80;
export const LEGACY_TOTAL_CELLS = 554;

function roughBox(d: string) {
  const tokens = d.match(/[MLHVCZ][^MLHVCZ]*/gi) || [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const token of tokens) {
    const cmd = token[0].toUpperCase();
    const nums = (token.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);
    switch (cmd) {
      case 'M':
        curX = nums[0];
        curY = nums[1];
        startX = curX;
        startY = curY;
        xs.push(curX);
        ys.push(curY);
        for (let i = 2; i + 1 < nums.length; i += 2) {
          curX = nums[i];
          curY = nums[i + 1];
          xs.push(curX);
          ys.push(curY);
        }
        break;
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          curX = nums[i];
          curY = nums[i + 1];
          xs.push(curX);
          ys.push(curY);
        }
        break;
      case 'H':
        for (const n of nums) {
          curX = n;
          xs.push(curX);
          ys.push(curY);
        }
        break;
      case 'V':
        for (const n of nums) {
          curY = n;
          xs.push(curX);
          ys.push(curY);
        }
        break;
      case 'C':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          xs.push(nums[i], nums[i + 2], nums[i + 4]);
          ys.push(nums[i + 1], nums[i + 3], nums[i + 5]);
          curX = nums[i + 4];
          curY = nums[i + 5];
        }
        break;
      case 'Z':
        curX = startX;
        curY = startY;
        break;
    }
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function legacyCells(
  svg: string,
  size: number = LEGACY_CELL_SIZE,
): LegacyCell[] {
  const cells: LegacyCell[] = [];
  const regex = /<path\s+id="([^"]+)"[^>]*\sd="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(svg)) !== null) {
    const [, zoneId, d] = match;
    const box = roughBox(d);
    const cols = Math.ceil((box.maxX - box.minX) / size);
    const rows = Math.ceil((box.maxY - box.minY) / size);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (
          isInside(
            [
              box.minX + col * size + size / 2,
              box.minY + row * size + size / 2,
            ],
            d,
          )
        )
          cells.push({ zoneId, row, col });
      }
    }
  }
  return cells;
}
