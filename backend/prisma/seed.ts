import 'dotenv/config';


import { PrismaClient } from '../generated/prisma/client';



import { PrismaPg } from '@prisma/adapter-pg';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function safeParseJson(field: string, rowId: string, fieldName: string) {
  try {
    return JSON.parse(field);
  } catch (err) {
    console.error(`Row ${rowId}: malformed JSON in "${fieldName}" — skipping row`);
    return null;
  }
}

const TERRITORY_SEED: { svgPathId: string; name: string; tier: string }[] = [
  { svgPathId: 'faculty-residence', name: 'Faculty Residence', tier: 'OUTPOST' },
  { svgPathId: 'm-hostel', name: 'M Hostel', tier: 'SETTLEMENT' },
  { svgPathId: 'd-hostel', name: 'D Hostel', tier: 'STRONGHOLD' },
  { svgPathId: 'j-hostel', name: 'J Hostel', tier: 'CITADEL' },
  { svgPathId: 'b-hostel', name: 'B Hostel', tier: 'OUTPOST' },
  { svgPathId: 'synth-track', name: 'Synthetic Track', tier: 'SETTLEMENT' },
  { svgPathId: 'cos-market', name: 'Cos Market', tier: 'STRONGHOLD' },
  { svgPathId: 'fete-area', name: 'Fete Area', tier: 'CITADEL' },
  { svgPathId: 'cricket-ground', name: 'Cricket Ground', tier: 'OUTPOST' },
  { svgPathId: 'k-hostel', name: 'K Hostel', tier: 'SETTLEMENT' },
  { svgPathId: 'sports-complex', name: 'Sports Complex', tier: 'STRONGHOLD' },
  { svgPathId: 'l-hostel', name: 'L Hostel', tier: 'CITADEL' },
  { svgPathId: 'eg-hostel', name: 'EG Hostel', tier: 'OUTPOST' },
  { svgPathId: 'ni-hostel', name: 'NI Hostel', tier: 'SETTLEMENT' },
  { svgPathId: 'polytech', name: 'Polytechnic College', tier: 'STRONGHOLD' },
  { svgPathId: 'lt', name: 'LT', tier: 'CITADEL' },
  { svgPathId: 'pg2-hostel', name: 'PG2 Hostel', tier: 'OUTPOST' },
  { svgPathId: 'nirvana', name: 'Nirvana', tier: 'SETTLEMENT' },
  { svgPathId: 'tan-g-block', name: 'Tan-G Block', tier: 'STRONGHOLD' },
  { svgPathId: 'bcd-block', name: 'BCD Block', tier: 'CITADEL' },
  { svgPathId: 'ef-block', name: 'EF Block', tier: 'OUTPOST' },
  { svgPathId: 'tslas', name: 'TSLAS', tier: 'SETTLEMENT' },
  { svgPathId: 'mech', name: 'Mechanical Workshop', tier: 'STRONGHOLD' },
  { svgPathId: 'elc-building', name: 'ELC Building', tier: 'CITADEL' },
  { svgPathId: 'library', name: 'Library', tier: 'OUTPOST' },
  { svgPathId: 'gods-plan', name: "God's Plan", tier: 'SETTLEMENT' },
  { svgPathId: 'guest-house', name: 'Guest House', tier: 'STRONGHOLD' },
  { svgPathId: 'main-audi', name: 'Main Auditorium', tier: 'CITADEL' },
  { svgPathId: 'parking', name: 'Parking', tier: 'OUTPOST' },
  { svgPathId: 'main-gate', name: 'Main Gate', tier: 'SETTLEMENT' },
  { svgPathId: 'csed', name: 'CSED', tier: 'STRONGHOLD' },
  { svgPathId: 'venture-lab', name: 'Venture Lab', tier: 'CITADEL' },
  { svgPathId: 'forest-area', name: 'Forest Area', tier: 'OUTPOST' },
  { svgPathId: 'coming-soon', name: 'Coming Soon', tier: 'SETTLEMENT' },
  { svgPathId: 'treatment-area', name: 'Treatment Area', tier: 'STRONGHOLD' },
  { svgPathId: 'staff-quarter-1', name: 'Staff Quarter 1', tier: 'CITADEL' },
  { svgPathId: 'staff-quarter-2', name: 'Staff Quarter 2', tier: 'OUTPOST' },
  { svgPathId: 'health-centre', name: 'Health Centre', tier: 'SETTLEMENT' },
  { svgPathId: 'waterbody', name: 'Waterbody', tier: 'STRONGHOLD' },
  { svgPathId: 'lp', name: 'LP', tier: 'CITADEL' },
  { svgPathId: 'c-hostel', name: 'C Hostel', tier: 'OUTPOST' },
  { svgPathId: 'o-hostel', name: 'O Hostel', tier: 'SETTLEMENT' },
  { svgPathId: 'pg1-hostel', name: 'PG1 Hostel', tier: 'STRONGHOLD' },
  { svgPathId: 'q-hostel', name: 'Q Hostel', tier: 'CITADEL' },
  { svgPathId: 'a-hostel', name: 'A Hostel', tier: 'OUTPOST' },
  { svgPathId: 'h-hostel', name: 'H Hostel', tier: 'SETTLEMENT' },
];

async function seedTerritories() {
  let created = 0;
  for (const t of TERRITORY_SEED) {
    await prisma.territory.upsert({
      where: { svgPathId: t.svgPathId },
      update: {},
      create: {
        svgPathId: t.svgPathId,
        name: t.name,
        tier: t.tier,
        baseValue: 0,
      },
    });
    created++;
  }
  console.log(`Territory seed complete: ${created} territories ensured.`);
}


async function main() {
  const csvPath = path.join(__dirname, 'seed-data', 'problems.csv');
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  let succeeded = 0;
  let skipped = 0;

  for (const row of rows) {
    const examples = safeParseJson(row.examples, row.id, 'examples');
    const constraints = safeParseJson(row.constraints, row.id, 'constraints');
    const testCases = safeParseJson(row.test_cases, row.id, 'test_cases');

    if (examples === null || constraints === null || testCases === null) {
      skipped++;
      continue;
    }

    try {
      await prisma.problem.upsert({
        where: { id: Number(row.id) },
        update: {},
        create: {
          id: Number(row.id),
          title: row.title,
          description: row.description,
          difficultyLevel: row.difficulty_level,
          examples,
          constraints,
          testCases,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        },
      });
      succeeded++;
    } catch (err) {
      console.error(`Row ${row.id}: DB write failed —`, err);
      skipped++;
    }
  }

  console.log(`\nSeed complete: ${succeeded} inserted, ${skipped} skipped`);

  await seedTerritories();
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
