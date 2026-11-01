import { campusDay, campusDayStart } from './day.util';

describe('campus day', () => {
  // 21:00 UTC on 1 Nov is 02:30 on 2 Nov in India.
  const lateUtc = new Date('2026-11-01T21:00:00Z');

  it('rolls over at midnight campus time, not midnight UTC', () => {
    expect(campusDay(lateUtc, 'Asia/Kolkata').toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(campusDay(lateUtc, 'UTC').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('finds the instant the campus day began', () => {
    expect(campusDayStart(lateUtc, 'Asia/Kolkata').toISOString()).toBe('2026-11-01T18:30:00.000Z');
    expect(campusDayStart(lateUtc, 'UTC').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('does not depend on the host timezone', () => {
    const noon = new Date('2026-11-01T06:30:00Z'); // noon in India
    expect(campusDay(noon, 'Asia/Kolkata').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});
