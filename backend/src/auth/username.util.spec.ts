import { USERNAME_PATTERN, randomUsername } from './username.util';

describe('username rules', () => {
  it('every generated default username is a valid one', () => {
    for (let i = 0; i < 200; i++) expect(randomUsername()).toMatch(USERNAME_PATTERN);
  });

  it('never derives a default from anything personal, and rarely repeats', () => {
    const names = new Set(Array.from({ length: 500 }, () => randomUsername()));
    expect(names.size).toBeGreaterThan(495);
    for (const name of names) expect(name).toMatch(/^player_[0-9a-f]{6}$/);
  });

  it.each(['abc', 'arjun_01', '___', 'a'.repeat(20), '123'])('accepts %j', (name) => {
    expect(USERNAME_PATTERN.test(name)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(21), 'bad name', 'dot.name', 'émile', '@arjun', 'Arjun_M', ''])('rejects %j', (name) => {
    expect(USERNAME_PATTERN.test(name)).toBe(false);
  });
});
