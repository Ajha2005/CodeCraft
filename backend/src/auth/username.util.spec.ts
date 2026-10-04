import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './dto/signup.dto';
import { USERNAME_PATTERN, randomUsername } from './username.util';

describe('username rules', () => {
  it('every generated default username is a valid one', () => {
    for (let i = 0; i < 200; i++) expect(randomUsername()).toMatch(USERNAME_PATTERN);
  });

  // The profile lookup trusts USERNAME_PATTERN, signup trusts the DTO: they must agree.
  it.each(['abc', 'arjun_01', '___', 'a'.repeat(20), '123', 'Arjun_M', '  Arjun_Mehta ', 'ab', 'a'.repeat(21), 'bad name', 'dot.name', 'émile', '@arjun'])(
    'signup and the profile lookup agree on %j',
    async (name) => {
      const dto = plainToInstance(SignupDto, { email: 'student@thapar.edu', password: 'password123', username: name });
      const errors = await validate(dto);
      expect(errors.length === 0).toBe(USERNAME_PATTERN.test(dto.username));
    },
  );
});
