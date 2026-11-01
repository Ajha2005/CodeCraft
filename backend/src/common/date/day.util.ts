/**
 * "Today" for the daily solve cap and the streak.
 *
 * A player's day has to end when they think it does, not when the server's clock
 * says so: a server running in UTC would otherwise roll the day over at 5:30 in
 * the morning for students in India, and `new Date().setHours(0, 0, 0, 0)` made
 * the stored dates depend on whatever timezone the host happened to use.
 *
 * Days are stored as the UTC-midnight Date of the calendar date in the campus
 * timezone (matching the `@db.Date` column), so they compare exactly.
 */

export const CAMPUS_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date of `now` in the campus timezone, as a UTC-midnight Date. */
export function campusDay(now: Date = new Date(), tz: string = CAMPUS_TIMEZONE): Date {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${key}T00:00:00.000Z`);
}

/** The real instant at which `now`'s campus day began (for timestamp columns). */
export function campusDayStart(now: Date = new Date(), tz: string = CAMPUS_TIMEZONE): Date {
  const wall = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(wall.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(campusDay(now, tz).getTime() - offsetMs);
}
