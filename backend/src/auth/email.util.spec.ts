import { normalizeEmail } from './email.util';

describe('normalizeEmail', () => {
  it('lower-cases an ordinary Thapar address', () => {
    expect(normalizeEmail('Arjun.Mehta@Thapar.EDU')).toBe(
      'arjun.mehta@thapar.edu',
    );
    expect(normalizeEmail('  a_b+c-d@thapar.edu ')).toBe('a_b+c-d@thapar.edu');
  });

  it.each([
    ['a longer domain', 'a@thapar.edu.evil.com'],
    ['a second @', 'evil@thapar.edu@x.com'],
    ['a quoted local part', '"a@evil.com"@thapar.edu'],
    ['a quoted local part (plain)', '"arjun"@thapar.edu'],
    ['a subdomain', 'a@mail.thapar.edu'],
    ['another domain', 'a@gmail.com'],
    ['no local part', '@thapar.edu'],
    ['a leading dot', '.a@thapar.edu'],
    ['a double dot', 'a..b@thapar.edu'],
    ['a trailing dot', 'a.@thapar.edu'],
    ['whitespace inside', 'a b@thapar.edu'],
    ['a newline', 'a@thapar.edu\n@evil.com'],
    ['a look-alike letter (Cyrillic а)', 'аrjun@thapar.edu'],
    ['a look-alike domain', 'a@thаpar.edu'],
    ['an empty string', ''],
    ['too long', `${'a'.repeat(70)}@thapar.edu`],
  ])('rejects %s', (_name, value) => {
    expect(normalizeEmail(value)).toBeNull();
  });

  it('rejects things that are not strings', () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail({ toString: () => 'a@thapar.edu' })).toBeNull();
  });

  it('does not fold the Kelvin sign into a plain k', () => {
    expect(normalizeEmail('Kelvin@thapar.edu')).toBeNull();
  });
});
