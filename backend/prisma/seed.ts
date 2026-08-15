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
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());