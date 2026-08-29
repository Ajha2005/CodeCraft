// backend/prisma/generate-grid.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isInside } from 'point-in-svg-polygon';

// ---- CONFIG: change this and re-run in --dry-run to see the resulting count ----
const CELL_SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.split('=')[1]) || 80;
const DRY_RUN = process.argv.includes('--dry-run');
// ----------------------------------------------------------------------------

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface PathEntry {
  svgPathId: string;
  d: string;
}

function extractPaths(svgContent: string): PathEntry[] {
  const paths: PathEntry[] = [];
  const regex = /<path\s+id="([^"]+)"[^>]*\sd="([^"]+)"/g;
  let match;
  while ((match = regex.exec(svgContent)) !== null) {
    paths.push({ svgPathId: match[1], d: match[2] });
  }
  return paths;
}

// Rough bounding box from the path's coordinate numbers (good enough for grid
// bounds — we don't need exact curve extents, just an outer box to grid over).
function boundingBox(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const tokens = d.match(/[MLHVCZ][^MLHVCZ]*/gi) || [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  const xs: number[] = [];
  const ys: number[] = [];

  for (const token of tokens) {
    const cmd = token[0].toUpperCase();
    const nums = (token.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);

    switch (cmd) {
      case 'M':
        curX = nums[0]; curY = nums[1];
        startX = curX; startY = curY;
        xs.push(curX); ys.push(curY);
        for (let i = 2; i + 1 < nums.length; i += 2) {
          curX = nums[i]; curY = nums[i + 1];
          xs.push(curX); ys.push(curY);
        }
        break;
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          curX = nums[i]; curY = nums[i + 1];
          xs.push(curX); ys.push(curY);
        }
        break;
      case 'H':
        for (const n of nums) {
          curX = n;
          xs.push(curX); ys.push(curY);
        }
        break;
      case 'V':
        for (const n of nums) {
          curY = n;
          xs.push(curX); ys.push(curY);
        }
        break;
      case 'C':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          xs.push(nums[i], nums[i + 2], nums[i + 4]);
          ys.push(nums[i + 1], nums[i + 3], nums[i + 5]);
          curX = nums[i + 4]; curY = nums[i + 5];
        }
        break;
      case 'Z':
        curX = startX; curY = startY;
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

async function main() {
  const svgPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'campus-map.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const paths = extractPaths(svgContent);

  console.log(`Found ${paths.length} territory paths. Grid cell size: ${CELL_SIZE}px\n`);

  let totalCells = 0;
  const cellsToInsert: { territorySvgPathId: string; row: number; col: number }[] = [];

  for (const { svgPathId, d } of paths) {
    const box = boundingBox(d);
    const cols = Math.ceil((box.maxX - box.minX) / CELL_SIZE);
    const rows = Math.ceil((box.maxY - box.minY) / CELL_SIZE);

    let validCount = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const centerX = box.minX + col * CELL_SIZE + CELL_SIZE / 2;
        const centerY = box.minY + row * CELL_SIZE + CELL_SIZE / 2;
        if (isInside([centerX, centerY], d)) {
          validCount++;
          cellsToInsert.push({ territorySvgPathId: svgPathId, row, col });
        }
      }
    }
    console.log(`  ${svgPathId}: ${validCount} cells`);
    totalCells += validCount;
  }

  console.log(`\nTotal valid cells across all territories: ${totalCells}`);

  if (DRY_RUN) {
  console.log('\n--dry-run set, nothing written to the database.');
  return;
}

// Look up all territory ids once instead of one findUnique per cell
const allTerritories = await prisma.territory.findMany();
const territoryIdByPathId = new Map(allTerritories.map((t) => [t.svgPathId, t.id]));

const rows = cellsToInsert
  .map((cell) => {
    const territoryId = territoryIdByPathId.get(cell.territorySvgPathId);
    if (!territoryId) return null;
    return { territoryId, row: cell.row, col: cell.col };
  })
  .filter((r): r is { territoryId: string; row: number; col: number } => r !== null);

// createMany in batches, skipping duplicates so this stays safely re-runnable
const BATCH_SIZE = 1000;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const result = await prisma.territoryCell.createMany({
    data: batch,
    skipDuplicates: true,
  });
  inserted += result.count;
}
console.log(`\nSeeded ${inserted} TerritoryCell rows (${rows.length} attempted, duplicates skipped).`);

  for (const cell of cellsToInsert) {
    const territory = await prisma.territory.findUnique({
      where: { svgPathId: cell.territorySvgPathId },
    });
    if (!territory) continue;
    await prisma.territoryCell.upsert({
      where: {
        territoryId_row_col: { territoryId: territory.id, row: cell.row, col: cell.col },
      },
      update: {},
      create: { territoryId: territory.id, row: cell.row, col: cell.col },
    });
  }
  console.log(`\nSeeded ${cellsToInsert.length} TerritoryCell rows.`);
}

main().finally(() => prisma.$disconnect());
