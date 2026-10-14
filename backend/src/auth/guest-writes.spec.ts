import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppController } from '../app.controller';
import { ContestController } from '../contest/contest.controller';
import { LeaderboardController } from '../leaderboard/leaderboard.controller';
import { ProblemsController } from '../problems/problems.controller';
import { RunController } from '../run/run.controller';
import { ScoringController } from '../scoring/scoring.controller';
import { SubmissionsController } from '../submissions/submissions.controller';
import { TerritoryController } from '../territory/territory.controller';
import { AuthController } from './auth.controller';
import { GUEST_CAN_WRITE_KEY } from './guest.decorators';

// Every controller in the app. A new controller has to be listed here, which is
// the moment to decide what a demo (guest) session may do in it.
const CONTROLLERS = [
  AppController,
  AuthController,
  ContestController,
  LeaderboardController,
  ProblemsController,
  RunController,
  ScoringController,
  SubmissionsController,
  TerritoryController,
];

const WRITES = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

function routes() {
  const found: {
    name: string;
    method: RequestMethod;
    guestCanWrite: boolean;
  }[] = [];
  for (const controller of CONTROLLERS) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    for (const key of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (
        controller.prototype as unknown as Record<string, unknown>
      )[key];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (method === undefined) continue; // not a route
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      found.push({
        name: `${RequestMethod[method]} /${[prefix, path].filter((p) => p && p !== '/').join('/')}`,
        method,
        guestCanWrite:
          Reflect.getMetadata(GUEST_CAN_WRITE_KEY, handler) === true,
      });
    }
  }
  return found;
}

describe('what a demo (guest) session may write', () => {
  it('is exactly starting a demo and running code on the examples', () => {
    const open = routes()
      .filter((r) => r.guestCanWrite)
      .map((r) => r.name)
      .sort();
    expect(open).toEqual(['POST /auth/guest', 'POST /run']);
  });

  it('is never granted on a route that does not write', () => {
    expect(
      routes().filter((r) => r.guestCanWrite && !WRITES.has(r.method)),
    ).toEqual([]);
  });

  it('is never granted to a whole controller at once', () => {
    for (const controller of CONTROLLERS) {
      expect(
        Reflect.getMetadata(GUEST_CAN_WRITE_KEY, controller),
      ).toBeUndefined();
    }
  });

  it('is checked against the writes that really exist (the scan would otherwise prove nothing)', () => {
    const writes = routes()
      .filter((r) => WRITES.has(r.method))
      .map((r) => r.name);
    expect(writes).toEqual(
      expect.arrayContaining([
        'POST /submissions',
        'POST /contests/challenges',
        'PATCH /auth/settings',
        'POST /run',
      ]),
    );
    expect(
      writes.filter(
        (name) => !routes().find((r) => r.name === name)?.guestCanWrite,
      ).length,
    ).toBeGreaterThan(5);
  });
});
