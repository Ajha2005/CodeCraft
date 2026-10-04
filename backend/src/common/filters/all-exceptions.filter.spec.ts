import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const filter = new AllExceptionsFilter();
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res }),
  };
  jest
    .spyOn(
      (filter as unknown as { logger: { error: () => void } }).logger,
      'error',
    )
    .mockImplementation(() => undefined);
  filter.catch(exception, host as never);
  return {
    status: res.status.mock.calls[0]?.[0],
    body: res.json.mock.calls[0]?.[0],
  };
}

describe('AllExceptionsFilter', () => {
  it('passes deliberate HTTP errors through', () => {
    expect(run(new ForbiddenException('Demo mode is read-only.'))).toEqual({
      status: 403,
      body: expect.objectContaining({ message: 'Demo mode is read-only.' }),
    });
    expect(
      run(new ServiceUnavailableException({ status: 'degraded' })).status,
    ).toBe(503);
    expect(
      run(new BadRequestException(['limit must not be greater than 100']))
        .status,
    ).toBe(400);
  });

  it('turns an unexpected error into a bare 500 with no detail', () => {
    const { status, body } = run(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    );
    expect(status).toBe(500);
    expect(body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|hunter2|stack/);
  });

  it.each([
    ['P2002', 409],
    ['P2003', 409],
    ['P2025', 404],
  ])(
    'maps the Prisma error %s to %i without echoing the query',
    (code, expected) => {
      const { status, body } = run(
        Object.assign(
          new Error('Unique constraint failed on the fields: (`email`)'),
          { code },
        ),
      );
      expect(status).toBe(expected);
      expect(JSON.stringify(body)).not.toContain('email');
    },
  );

  it('answers other Prisma errors with a plain 500', () => {
    expect(
      run(Object.assign(new Error('boom'), { code: 'P2021' })).status,
    ).toBe(500);
  });

  it('keeps parser failures as client errors, with fixed wording', () => {
    const tooBig = run(
      Object.assign(new Error('request entity too large'), {
        status: 413,
        type: 'entity.too.large',
      }),
    );
    expect(tooBig).toEqual({
      status: 413,
      body: { statusCode: 413, message: 'Payload too large' },
    });
    const malformed = run(
      Object.assign(
        new SyntaxError('Unexpected token } in JSON at position 3'),
        { status: 400, type: 'entity.parse.failed' },
      ),
    );
    expect(malformed.body).toEqual({
      statusCode: 400,
      message: 'Malformed JSON body',
    });
  });

  it('does nothing for non-HTTP contexts', () => {
    const filter = new AllExceptionsFilter();
    jest
      .spyOn(
        (filter as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    expect(() =>
      filter.catch(new Error('x'), { getType: () => 'ws' } as never),
    ).not.toThrow();
  });
});
