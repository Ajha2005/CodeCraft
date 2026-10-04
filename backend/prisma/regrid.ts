// backend/prisma/regrid.ts
//
// Moves the live campus map to the 1000-cell grid (TOTAL_CELLS in
// src/territory/grid/grid.config.ts) without losing anyone's territory.
//
//   npx tsx prisma/regrid.ts            dry run: reads the database, prints the plan, changes nothing
//   npx tsx prisma/regrid.ts --apply    makes the change, in one transaction
//
// Safe to run again: once the map is on the new grid it does nothing. It also
// builds the map from scratch on a database that has the territories but no
// cells yet (use it instead of generate-grid.ts).
//
// Take a pg_dump first. This is the only script that rewrites the map.
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { formatRegridReport, regrid } from '../src/territory/grid/regrid';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply');
if (unknown.length > 0) {
  console.error(
    `Unknown option(s): ${unknown.join(' ')}\nUsage: tsx prisma/regrid.ts [--apply]`,
  );
  process.exit(2);
}
const APPLY = args.includes('--apply');

function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`; // never the user or password
  } catch {
    return '(DATABASE_URL is not set or not a URL)';
  }
}

// The campus outline lives with the frontend. Works from prisma/ (tsx) and from dist/prisma/ (compiled).
function findCampusSvg(): string {
  const relative = ['frontend', 'src', 'assets', 'campus-map.svg'];
  const candidates = [
    process.env.CAMPUS_SVG,
    path.join(__dirname, '..', '..', ...relative),
    path.join(__dirname, '..', '..', '..', ...relative),
  ];
  const found = candidates.find(
    (file): file is string => !!file && fs.existsSync(file),
  );
  if (!found)
    throw new Error(
      'Could not find frontend/src/assets/campus-map.svg (set CAMPUS_SVG to its path)',
    );
  return found;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const svg = fs.readFileSync(findCampusSvg(), 'utf-8');

  console.log(`Database: ${describeTarget()}`);
  console.log(
    APPLY
      ? 'Mode: APPLY (this changes the database)\n'
      : 'Mode: dry run (reads only)\n',
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const report = await regrid(prisma, { svg, apply: APPLY });
    console.log(formatRegridReport(report));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `\nRegrid failed, nothing was changed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
