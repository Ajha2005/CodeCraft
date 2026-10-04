// backend/prisma/users-report.ts
//
// READ-ONLY. Counts the accounts that matter for switching sign-in to Google
// only, and for the email clean-up. It prints numbers, never an email, a name
// or an id.
//
//   npx tsx prisma/users-report.ts
//
// What the numbers mean:
//   googleId IS NULL          never signed in with Google. These are the accounts
//                             Google-only sign-in affects.
//   password and no Google    can only get in with the old email + password form.
//                             Once that is switched off (the default) they get back in
//                             by signing in with Google on the same @thapar.edu address:
//                             the account, its cells and its score are kept and the old
//                             password is wiped. The ones that cannot are accounts
//                             created with an address that is not a real mailbox (signup
//                             never checked), which is why the "with activity" line matters.
//   email not lowercase       fixed by the lowercase migration where it is safe;
//   ...ambiguous              two accounts differ only by case, so the migration left
//                             both alone and someone has to merge them by hand.
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function hostOf(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '');
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(not set or not a URL)';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  console.log(`Database: ${hostOf(process.env.DATABASE_URL)} (read only)\n`);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const [row] = await prisma.$queryRaw<
      {
        total: bigint;
        no_google: bigint;
        has_password: bigint;
        password_only: bigint;
        password_only_active: bigint;
        both: bigint;
        neither: bigint;
        not_lowercase: bigint;
        case_ambiguous: bigint;
        other_domain: bigint;
      }[]
    >`
      WITH active AS (
        SELECT DISTINCT "userId" FROM submissions
        UNION SELECT DISTINCT "userId" FROM territory_cell_ownerships
      )
      SELECT
        count(*)                                                                   AS total,
        count(*) FILTER (WHERE u."googleId" IS NULL)                               AS no_google,
        count(*) FILTER (WHERE u."passwordHash" IS NOT NULL)                       AS has_password,
        count(*) FILTER (WHERE u."googleId" IS NULL AND u."passwordHash" IS NOT NULL) AS password_only,
        count(*) FILTER (WHERE u."googleId" IS NULL AND u."passwordHash" IS NOT NULL AND u.id IN (SELECT "userId" FROM active)) AS password_only_active,
        count(*) FILTER (WHERE u."googleId" IS NOT NULL AND u."passwordHash" IS NOT NULL) AS both,
        count(*) FILTER (WHERE u."googleId" IS NULL AND u."passwordHash" IS NULL)  AS neither,
        count(*) FILTER (WHERE u.email <> lower(u.email))                          AS not_lowercase,
        count(*) FILTER (WHERE u.email <> lower(u.email) AND (SELECT count(*) FROM "User" o WHERE lower(o.email) = lower(u.email)) > 1) AS case_ambiguous,
        count(*) FILTER (WHERE lower(u.email) NOT LIKE '%@thapar.edu')             AS other_domain
      FROM "User" u`;

    const n = (v: bigint) => Number(v);
    console.log(
      `Accounts:                                           ${n(row.total)}`,
    );
    console.log(
      `  never signed in with Google (googleId IS NULL):   ${n(row.no_google)}`,
    );
    console.log(
      `  have a password hash:                             ${n(row.has_password)}`,
    );
    console.log(
      `  password and no Google (affected by Google-only): ${n(row.password_only)}`,
    );
    console.log(
      `    ...of which already have submissions or cells:  ${n(row.password_only_active)}`,
    );
    console.log(
      `  both Google and a password:                       ${n(row.both)}`,
    );
    console.log(
      `  neither (cannot sign in at all):                  ${n(row.neither)}`,
    );
    console.log(`Email hygiene:`);
    console.log(
      `  email not all lowercase:                          ${n(row.not_lowercase)}`,
    );
    console.log(
      `  ...and ambiguous (same address in another case):  ${n(row.case_ambiguous)}`,
    );
    console.log(
      `  email outside @thapar.edu:                        ${n(row.other_domain)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `\nusers-report failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
