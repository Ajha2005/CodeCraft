import { isGuestWriteAllowed } from './access.guard';

describe('isGuestWriteAllowed', () => {
  it('allows exactly the two writes a demo session needs', () => {
    expect(isGuestWriteAllowed('POST', '/auth/guest')).toBe(true);
    expect(isGuestWriteAllowed('POST', '/run')).toBe(true);
    expect(isGuestWriteAllowed('post', '/run/')).toBe(true); // method case and a trailing slash do not matter
  });

  it.each([
    ['POST', '/submissions'],
    ['POST', '/contests/challenges'],
    ['POST', '/contests/abc/accept'],
    ['PATCH', '/auth/settings'],
    ['DELETE', '/anything'],
    ['PUT', '/run'],
    ['POST', '/run/extra'],
    ['POST', '/runner'],
    ['POST', '//run'],
    ['POST', '/Run'],
    ['POST', '/auth/guest/../submissions'],
    ['POST', '/auth/login'],
  ])('does not allow %s %s', (method, path) => {
    expect(isGuestWriteAllowed(method, path)).toBe(false);
  });
});
