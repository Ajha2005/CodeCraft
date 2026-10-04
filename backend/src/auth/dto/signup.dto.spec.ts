import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './signup.dto';

async function check(username: unknown) {
  const dto = plainToInstance(SignupDto, { email: 'student@thapar.edu', password: 'password123', username });
  const errors = await validate(dto);
  return { dto, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
}

describe('SignupDto username', () => {
  it.each(['abc', 'arjun_01', '___', 'a'.repeat(20), '123'])('accepts %s', async (name) => {
    expect((await check(name)).messages).toEqual([]);
  });

  it('trims and lowercases before validating, so casing never makes two names', async () => {
    const { dto, messages } = await check('  Arjun_Mehta ');
    expect(messages).toEqual([]);
    expect(dto.username).toBe('arjun_mehta');
  });

  it.each(['ab', 'a'.repeat(21)])('rejects a name that is not 3-20 characters (%s)', async (name) => {
    expect((await check(name)).messages).toContain('Username must be 3-20 characters');
  });

  it.each(['bad name', 'bad-name', 'dot.name', 'name!', 'émile', 'tab\tname', '@arjun'])(
    'rejects characters other than letters, numbers and underscores (%s)',
    async (name) => {
      expect((await check(name)).messages).toContain('Username can only contain letters, numbers and underscores');
    },
  );

  it.each([undefined, null, 42, {}])('requires a string (%p)', async (value) => {
    expect((await check(value)).messages).toContain('Username is required');
  });

  it('puts "required" first when the username is missing', async () => {
    expect((await check(undefined)).messages[0]).toBe('Username is required');
  });
});
