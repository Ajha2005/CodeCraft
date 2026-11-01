/**
 * Player colours.
 *
 * Every player owns a permanent sequence number (`User.colorIndex`, handed out
 * by the database, never reused). Their colour is a pure function of that
 * number, which gives two guarantees a hash of the user id could not:
 *
 *   - no two players share a colour (checked for the first 10,000 players, far
 *     more than the campus has; past that, a rare clash is possible), and
 *   - players signing up one after another get colours that are far apart
 *     (each new hue lands 137.5° from the previous one, the "golden angle", so
 *     the wheel is filled evenly however many players join).
 *
 * Colours are always saturated and bright enough to read on the dark map, and
 * can never be confused with the grey of unclaimed ground.
 */

const GOLDEN_ANGLE = 137.50776405003785;
// Neighbouring slots in the sequence differ in lightness too, so two players
// whose hues drift close together still look different.
const LIGHTNESS_STEPS = [56, 64, 48] as const;

export const UNCLAIMED_COLOR = '#94a3b8'; // slate-400

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const v = light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The colour of the player holding sequence number `index`. */
export function colorFromIndex(index: number): string {
  const n = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const hue = (n * GOLDEN_ANGLE) % 360;
  // Blues and purples look dark on a dark map at the same lightness; lift them.
  const blueLift = 12 * Math.exp(-(((hue - 250) / 40) ** 2));
  // Slow secondary cycles in lightness and saturation keep the colours distinct
  // as hex values long after the hue ring alone would start repeating.
  const lightness =
    LIGHTNESS_STEPS[n % LIGHTNESS_STEPS.length] +
    (Math.floor(n / 3) % 5) * 1.2 -
    2.4 +
    blueLift;
  const saturation = 86 + (Math.floor(n / 15) % 5) * 3.5;
  return hslToHex(hue, saturation, lightness);
}

/** Anything that can look a user up - the Prisma client, or a transaction. */
interface UserColorDb {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { colorIndex: true };
    }): PromiseLike<{ colorIndex: number } | null>;
  };
}

/** The colour of one player, or the unclaimed grey for an unknown id. */
export async function lookupUserColor(
  db: UserColorDb,
  userId: string | null | undefined,
): Promise<string> {
  if (!userId) return UNCLAIMED_COLOR;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { colorIndex: true },
  });
  return user ? colorFromIndex(user.colorIndex) : UNCLAIMED_COLOR;
}
