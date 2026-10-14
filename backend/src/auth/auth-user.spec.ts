import { isGuestId, userFromPayload } from './auth-user';

describe('userFromPayload', () => {
  it('reads a token issued before demo sessions existed (no role) as an account', () => {
    expect(
      userFromPayload({
        sub: '6f1c2d3e-0000-4000-8000-000000000001',
        email: 'a@thapar.edu',
      }),
    ).toEqual({
      userId: '6f1c2d3e-0000-4000-8000-000000000001',
      email: 'a@thapar.edu',
      role: 'USER',
      isGuest: false,
    });
  });

  it('reads a guest token as a demo caller with nothing personal', () => {
    expect(userFromPayload({ sub: 'guest:3b0f', role: 'GUEST' })).toEqual({
      userId: 'guest:3b0f',
      role: 'GUEST',
      isGuest: true,
    });
  });

  it('does not let one kind of session pose as the other', () => {
    expect(
      userFromPayload({
        sub: '6f1c2d3e-0000-4000-8000-000000000001',
        role: 'GUEST',
      }),
    ).toBeNull(); // guest role, account id
    expect(userFromPayload({ sub: 'guest:3b0f', role: 'USER' })).toBeNull(); // account role, guest id
    expect(userFromPayload({ sub: 'guest:3b0f' })).toBeNull(); // no role means account, and an account never has a guest id
  });

  it('rejects claims that make no sense', () => {
    expect(userFromPayload(null)).toBeNull();
    expect(userFromPayload(undefined)).toBeNull();
    expect(userFromPayload({})).toBeNull();
    expect(userFromPayload({ sub: '' })).toBeNull();
    expect(userFromPayload({ sub: 42 as unknown as string })).toBeNull();
    expect(userFromPayload({ sub: 'u1', role: 'ADMIN' as never })).toBeNull();
  });

  it('ignores an email that is not a string', () => {
    expect(
      userFromPayload({ sub: 'u1', email: 7 as unknown as string }),
    ).toEqual({ userId: 'u1', role: 'USER', isGuest: false });
  });
});

describe('isGuestId', () => {
  it('only a guest: prefix counts', () => {
    expect(isGuestId('guest:abc')).toBe(true);
    expect(isGuestId('Guest:abc')).toBe(false);
    expect(isGuestId(' guest:abc')).toBe(false);
    expect(isGuestId('abc')).toBe(false);
    expect(isGuestId(null)).toBe(false);
    expect(isGuestId(undefined)).toBe(false);
  });
});
