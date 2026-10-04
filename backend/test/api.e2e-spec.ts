// The whole HTTP and WebSocket surface against a real (scratch) Postgres and
// Redis, with the code runner replaced by a scripted one. It checks what the
// public deployment depends on: who can call what, what a response may contain,
// and that a demo session cannot change anything. Needs TEST_DATABASE_URL and
// TEST_REDIS_URL pointing at throwaway local servers, see test/README.md.
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { getQueueToken } from '@nestjs/bullmq';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import * as jsonwebtoken from 'jsonwebtoken';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { JudgeService } from '../src/judge/judge.service';
import { regrid } from '../src/territory/grid/regrid';
import { parseZones } from '../src/territory/grid/svg-geometry';
import {
  emptyDatabase,
  scratchPrisma,
  scratchUrls,
} from './helpers/scratch-db';

const urls = scratchUrls();
const svg = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    'frontend',
    'src',
    'assets',
    'campus-map.svg',
  ),
  'utf-8',
);

// The environment has to be in place before the application modules are loaded.
const ORIGIN = 'https://app.example.test';
if (urls) {
  process.env.DATABASE_URL = urls.databaseUrl;
  process.env.REDIS_URL = urls.redisUrl;
  process.env.JWT_SECRET = randomBytes(48).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://127.0.0.1/auth/google/callback';
  process.env.FRONTEND_URL = ORIGIN;
  process.env.NODE_ENV = 'test';
  delete process.env.PASSWORD_LOGIN_ENABLED;
  delete process.env.CORS_ORIGINS;
}

// Numbers that only exist in a hidden test case, so a leak is easy to spot.
const HIDDEN_INPUT = 424242;
const HIDDEN_TARGET = 424244;
const ALICE_CODE = 'ALICE_PRIVATE_CODE_8c1d';
const OLD_DEFAULT_SECRET = 'dev_secret_change_this_in_production';

/** Replaces the two calls that reach Piston; boilerplate and parameter inference stay the real ones. */
class ScriptedJudge extends JudgeService {
  readonly seenInputs: unknown[] = [];

  constructor() {
    super(undefined as never, undefined as never);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async runSingleTestCase(
    code: string,
    input: Record<string, any>,
    expectedOutput: any,
  ) {
    this.seenInputs.push(input);
    const passed = !code.includes('WRONG');
    const expected = JSON.stringify(expectedOutput);
    return {
      passed,
      status: passed ? 'AC' : 'WA',
      input,
      actualOutput: passed ? expected : '[]',
      expectedOutput: expected,
      stderr: '',
    };
  }

  override async runAllTestCases(
    code: string,
    testCases: { input: Record<string, any>; expected_output: any }[],
  ) {
    const results = [];
    for (const tc of testCases)
      results.push(
        await this.runSingleTestCase(code, tc.input, tc.expected_output),
      );
    const totalPassed = results.filter((r) => r.passed).length;
    return {
      verdict: totalPassed === testCases.length ? 'AC' : 'WA',
      totalPassed,
      totalTests: testCases.length,
      results,
    };
  }
}

const maybe = urls ? describe : describe.skip;

maybe('the API against a scratch database', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let base: string;
  let judge: ScriptedJudge;
  let signToken: (userId: string) => Promise<string>;
  let guestToken: () => Promise<string>;
  let issueLoginCode: (userId: string) => Promise<string>;

  let alice: { id: string };
  let bob: { id: string };
  let aliceToken: string;
  let bobToken: string;
  let aliceCells: string[] = [];
  let bobCells: string[] = [];
  let contestId: string;

  const get = (p: string, token?: string) => {
    const req = request(base).get(p);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const post = (p: string, body: unknown, token?: string) => {
    const req = request(base)
      .post(p)
      .send(body as object);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const patch = (p: string, body: unknown, token?: string) => {
    const req = request(base)
      .patch(p)
      .send(body as object);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  /** Exact row count of every table: a request that must not write anything is checked against this. */
  async function rowCounts(): Promise<Record<string, number>> {
    const rows = await prisma.$queryRaw<{ table_name: string; n: number }[]>`
      SELECT table_name,
             (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    return Object.fromEntries(rows.map((r) => [r.table_name, r.n]));
  }

  function resetThrottle() {
    const storage = app.get(ThrottlerStorage) as unknown as {
      _storage: Map<unknown, unknown>;
      hitExpirations: Map<unknown, unknown>;
    };
    storage._storage.clear();
    storage.hitExpirations.clear();
  }

  beforeAll(async () => {
    const zones = parseZones(svg);
    prisma = scratchPrisma((urls as { databaseUrl: string }).databaseUrl);
    redis = new Redis((urls as { redisUrl: string }).redisUrl);
    await redis.flushdb();

    // ---- the world: 1000 cells, two players, problems, a duel, scores
    await emptyDatabase(prisma);
    await prisma.territory.createMany({
      data: zones.map((z) => ({
        name: z.id,
        svgPathId: z.id,
        tier: 'OUTPOST',
      })),
    });
    await regrid(prisma, { svg, apply: true });

    const now = new Date();
    const example = {
      input: { nums: [2, 7, 11, 15], target: 9 },
      output: [0, 1],
    };
    const hidden = [
      { input: { nums: [3, 2, 4], target: 6 }, expected_output: [1, 2] },
      {
        input: { nums: [HIDDEN_INPUT, 2], target: HIDDEN_TARGET },
        expected_output: [0, 1],
      },
    ];
    for (const id of [1, 2]) {
      await prisma.problem.create({
        data: {
          id,
          title: `Two Sum ${id}`,
          description: 'Find two numbers that add up to the target.',
          difficultyLevel: 'Easy',
          examples: [example],
          constraints: ['2 <= nums.length'],
          testCases: hidden,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    alice = await prisma.user.create({
      data: {
        email: 'alice.tester@thapar.edu',
        username: 'alice',
        googleId: 'google-alice',
      },
    });
    bob = await prisma.user.create({
      data: {
        email: 'bob.tester@thapar.edu',
        username: 'bob',
        googleId: 'google-bob',
      },
    });

    const cells = await prisma.territoryCell.findMany({
      where: { retiredAt: null },
      orderBy: [{ territoryId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
      take: 5,
    });
    aliceCells = cells.slice(0, 3).map((c) => c.id);
    bobCells = cells.slice(3, 5).map((c) => c.id);
    await prisma.territoryCellOwnership.createMany({
      data: [
        ...aliceCells.map((cellId) => ({
          cellId,
          userId: alice.id,
          sourceType: 'solve',
        })),
        ...bobCells.map((cellId) => ({
          cellId,
          userId: bob.id,
          sourceType: 'solve',
        })),
      ],
    });
    const contest = await prisma.contest.create({
      data: {
        cellId: bobCells[0],
        pledgedCellId: aliceCells[0],
        problemId: 1,
        challengerId: alice.id,
        defenderId: bob.id,
        status: 'PENDING',
      },
    });
    contestId = contest.id;

    for (const [user, score] of [
      [alice, 12.5],
      [bob, 7.5],
    ] as const) {
      const submission = await prisma.submission.create({
        data: {
          userId: user.id,
          problemId: 1,
          code: user === alice ? ALICE_CODE : 'bob_code',
          language: 'python',
          verdict: 'AC',
          totalPassed: 2,
          totalTests: 2,
          pointsAwarded: true,
        },
      });
      await prisma.performanceScore.create({
        data: {
          submissionId: submission.id,
          difficultyWeight: 1,
          correctness: 1,
          attemptsPenalty: 0,
          timeEfficiency: 1,
          totalScore: score,
        },
      });
    }

    // ---- the application
    judge = new ScriptedJudge();
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const { AuthService } = await import('../src/auth/auth.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JudgeService)
      .useValue(judge)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const auth = app.get(AuthService);
    signToken = async (userId) => (await auth.signToken(userId)).accessToken;
    guestToken = async () => (await auth.issueGuestToken()).accessToken;
    issueLoginCode = (userId) => auth.issueLoginCode(userId);
    aliceToken = await signToken(alice.id);
    bobToken = await signToken(bob.id);

    // The board was empty at start, so the server refilled it from Postgres.
    for (
      let i = 0;
      i < 50 && (await redis.zcard('leaderboard:college')) < 2;
      i++
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
    await prisma?.$disconnect();
  });

  // ------------------------------------------------------------------------
  describe('anonymous visitors', () => {
    it('can see only what the login page needs', async () => {
      expect((await get('/health')).status).toBe(200);
      const problems = await get('/problems?limit=1');
      expect(problems.status).toBe(200);
      expect(problems.body.items).toHaveLength(1);
      expect((await get('/leaderboard/college?limit=1')).status).toBe(200);
      const zones = await get('/territories');
      expect(zones.status).toBe(200);
      expect(zones.body).toHaveLength(46);
    });

    it.each([
      '/problems',
      '/problems?limit=2',
      '/problems/1',
      '/leaderboard/college',
      '/leaderboard/college?limit=2',
      '/leaderboard/territory/anything',
      '/leaderboard/me/rank',
      '/leaderboard/me/near-miss',
      '/territories/grid',
      '/territories/owners',
      '/auth/me',
      '/users/alice',
      '/contests/incoming',
      '/contests/outgoing',
      '/contests/active',
      `/contests/${randomUUID()}`,
      '/scoring/me',
      '/scoring/me/territories',
      '/scoring/me/daily-progress',
      '/scoring/me/streak',
      '/scoring/me/campaign-summary',
      `/scoring/submission/${randomUUID()}`,
      '/submissions/me/status',
      `/submissions/${randomUUID()}`,
    ])('GET %s needs a token', async (p) => {
      expect((await get(p)).status).toBe(401);
    });

    it.each([
      ['/submissions', { problemId: 1, language: 'python', code: 'x' }],
      ['/run', { problemId: 1, language: 'python', code: 'x' }],
      ['/contests/challenges', {}],
      [`/contests/${randomUUID()}/accept`, {}],
      [`/contests/${randomUUID()}/decline`, {}],
      [
        `/contests/${randomUUID()}/submissions`,
        { code: 'x', language: 'python' },
      ],
    ])('POST %s needs a token', async (p, body) => {
      expect((await post(p, body)).status).toBe(401);
    });

    it('cannot change settings', async () => {
      expect(
        (await patch('/auth/settings', { flavorTextEnabled: false })).status,
      ).toBe(401);
    });

    it('finds nothing at the routes that were removed', async () => {
      for (const p of [
        '/',
        '/judge/run',
        '/judge/test-all',
        '/territories/cells',
        `/scoring/user/${alice.id}`,
        `/scoring/campaign-summary/${alice.id}`,
        `/leaderboard/rank/${alice.id}`,
        `/submissions/status/${alice.id}`,
      ]) {
        expect([404, 401]).toContain((await get(p)).status);
        expect((await get(p)).status).not.toBe(200);
      }
      expect(
        (await post('/judge/run', { code: 'print(1)', language: 'python' }))
          .status,
      ).toBe(404);
    });

    it('is told sign-up is gone, and that password sign-in is off', async () => {
      const signup = await post('/auth/signup', {
        email: 'new@thapar.edu',
        password: 'whatever123',
        username: 'newbie',
      });
      expect(signup.status).toBe(410);
      const login = await post('/auth/login', {
        email: 'alice.tester@thapar.edu',
        password: 'whatever123',
      });
      expect(login.status).toBe(403);
      expect(JSON.stringify(login.body)).not.toMatch(/token/i);
    });

    it('is ignored when it sends a bad token to a public route', async () => {
      const res = await get('/territories', 'not.a.token');
      expect(res.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------
  describe('access tokens', () => {
    const secret = () => process.env.JWT_SECRET as string;
    const claims = () => ({ sub: alice.id, role: 'USER' });
    const sign = (
      payload: object,
      key: string,
      options: jsonwebtoken.SignOptions = {},
    ) =>
      jsonwebtoken.sign(payload, key, {
        algorithm: 'HS256',
        issuer: 'codecraft-api',
        audience: 'codecraft-app',
        expiresIn: '1h',
        ...options,
      });

    it('accepts a token the server issued, and it names only who and what role', async () => {
      const res = await get('/auth/me', aliceToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        username: 'alice',
        role: 'USER',
        isGuest: false,
      });
      const payload = jsonwebtoken.decode(aliceToken) as Record<
        string,
        unknown
      >;
      expect(Object.keys(payload).sort()).toEqual([
        'aud',
        'exp',
        'iat',
        'iss',
        'role',
        'sub',
      ]);
      expect(JSON.stringify(payload)).not.toMatch(/@|email/i);
    });

    it('rejects a token forged with the old default secret that used to be in the source', async () => {
      const forged = jsonwebtoken.sign(
        { sub: alice.id, email: 'alice.tester@thapar.edu', username: 'alice' },
        OLD_DEFAULT_SECRET,
        { expiresIn: '1h' },
      );
      for (const p of [
        '/auth/me',
        '/problems',
        '/scoring/me',
        '/territories/owners',
      ]) {
        expect((await get(p, forged)).status).toBe(401);
      }
      expect(
        (
          await post(
            '/submissions',
            { problemId: 1, language: 'python', code: 'x' },
            forged,
          )
        ).status,
      ).toBe(401);
      // Even when it is dressed up like a real one.
      const dressed = sign(claims(), OLD_DEFAULT_SECRET);
      expect((await get('/auth/me', dressed)).status).toBe(401);
    });

    it('rejects a token signed with any other secret', async () => {
      expect(
        (
          await get(
            '/auth/me',
            sign(claims(), randomBytes(48).toString('base64')),
          )
        ).status,
      ).toBe(401);
    });

    it('rejects an unsigned (alg none) token', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({
          ...claims(),
          iss: 'codecraft-api',
          aud: 'codecraft-app',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');
      expect((await get('/auth/me', `${header}.${body}.`)).status).toBe(401);
    });

    it('rejects a token signed with another algorithm, even with the right secret', async () => {
      expect(
        (
          await get(
            '/auth/me',
            sign(claims(), secret(), { algorithm: 'HS512' }),
          )
        ).status,
      ).toBe(401);
    });

    it('rejects an expired token', async () => {
      expect(
        (await get('/auth/me', sign(claims(), secret(), { expiresIn: -60 })))
          .status,
      ).toBe(401);
    });

    it('rejects a token meant for something else', async () => {
      expect(
        (
          await get(
            '/auth/me',
            sign(claims(), secret(), { issuer: 'someone-else' }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await get(
            '/auth/me',
            sign(claims(), secret(), { audience: 'another-app' }),
          )
        ).status,
      ).toBe(401);
    });

    it('rejects a guest token that carries a user id, and a user token that carries a guest id', async () => {
      expect(
        (
          await get(
            '/auth/me',
            sign({ sub: alice.id, role: 'GUEST' }, secret()),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await get(
            '/auth/me',
            sign({ sub: `guest:${randomUUID()}`, role: 'USER' }, secret()),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await get(
            '/auth/me',
            sign({ sub: alice.id, role: 'ADMIN' }, secret()),
          )
        ).status,
      ).toBe(401);
      expect(
        (await get('/auth/me', sign({ sub: alice.id }, secret()))).status,
      ).toBe(401);
    });

    it('answers 401, not 500, for a valid token whose user no longer exists', async () => {
      const ghost = await signToken(randomUUID());
      expect((await get('/auth/me', ghost)).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------------
  describe('demo (guest) sessions', () => {
    it('start without a database write and last two hours', async () => {
      const before = await rowCounts();
      const res = await post('/auth/guest', {});
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'role',
      ]);
      expect(res.body).toMatchObject({ role: 'GUEST', expiresIn: 7200 });
      const payload = jsonwebtoken.decode(res.body.accessToken) as {
        sub: string;
        role: string;
        iat: number;
        exp: number;
      };
      expect(payload.sub).toMatch(/^guest:[0-9a-f-]{36}$/);
      expect(payload.role).toBe('GUEST');
      expect(payload.exp - payload.iat).toBe(7200);
      expect(Object.keys(payload).sort()).toEqual([
        'aud',
        'exp',
        'iat',
        'iss',
        'role',
        'sub',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/refresh/i);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await rowCounts()).toEqual(before);
    });

    it('can read the problems, the map and the leaderboard', async () => {
      const token = await guestToken();
      for (const p of [
        '/problems',
        '/problems/1',
        '/territories',
        '/territories/grid',
        '/territories/owners',
        '/leaderboard/college',
        '/users/alice',
        '/auth/me',
      ]) {
        const res = await get(p, token);
        expect([p, res.status]).toEqual([p, 200]);
      }
    });

    it('is shown as a guest, with nothing of its own', async () => {
      const token = await guestToken();
      expect((await get('/auth/me', token)).body).toMatchObject({
        role: 'GUEST',
        isGuest: true,
        username: 'guest',
      });
      expect((await get('/contests/incoming', token)).body).toEqual([]);
      expect((await get('/contests/outgoing', token)).body).toEqual([]);
      expect((await get('/contests/active', token)).body).toEqual([]);
      expect((await get('/submissions/me/status', token)).body).toEqual({});
      expect((await get('/leaderboard/me/rank', token)).body).toEqual({
        rank: null,
      });
      expect((await get('/scoring/me', token)).status).toBe(200);
      expect((await get('/scoring/me/territories', token)).body).toEqual([]);
      expect((await get('/users/alice', token)).body.isMe).toBe(false);
    });

    it('cannot open a duel room', async () => {
      expect(
        (await get(`/contests/${contestId}`, await guestToken())).status,
      ).toBe(403);
    });

    it('cannot write anything, and nothing is written when it tries', async () => {
      const token = await guestToken();
      const before = await rowCounts();
      const attempts: [string, () => request.Test][] = [
        [
          'POST /submissions',
          () =>
            post(
              '/submissions',
              { problemId: 2, language: 'python', code: 'print(1)' },
              token,
            ),
        ],
        [
          'PATCH /auth/settings',
          () => patch('/auth/settings', { flavorTextEnabled: false }, token),
        ],
        [
          'POST /contests/challenges',
          () =>
            post(
              '/contests/challenges',
              { cellId: bobCells[0], pledgedCellId: aliceCells[0] },
              token,
            ),
        ],
        ['POST accept', () => post(`/contests/${contestId}/accept`, {}, token)],
        [
          'POST decline',
          () => post(`/contests/${contestId}/decline`, {}, token),
        ],
        [
          'POST contest submission',
          () =>
            post(
              `/contests/${contestId}/submissions`,
              { code: 'x', language: 'python' },
              token,
            ),
        ],
      ];
      for (const [name, attempt] of attempts) {
        const res = await attempt();
        expect([name, res.status]).toEqual([name, 403]);
        expect(res.body.message).toMatch(/read-only/i);
        expect(res.body.message).toMatch(/Sign in with a Thapar ID/);
      }
      expect(await rowCounts()).toEqual(before);
      const contest = await prisma.contest.findUniqueOrThrow({
        where: { id: contestId },
      });
      expect(contest.status).toBe('PENDING');
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
      });
      expect(user.flavorTextEnabled).toBe(true);
    });

    it('may only mint more guest sessions and run the samples', async () => {
      const token = await guestToken();
      expect((await post('/auth/guest', {}, token)).status).toBe(200);
      expect(
        (
          await post(
            '/run',
            { problemId: 1, language: 'python', code: 'print(1)' },
            token,
          )
        ).status,
      ).toBe(200);
    });
  });

  // ------------------------------------------------------------------------
  describe('POST /run', () => {
    const body = (extra: object = {}) => ({
      problemId: 1,
      language: 'python',
      code: 'def twoSum(nums, target):\n    return [0, 1]\n',
      ...extra,
    });

    beforeEach(() => {
      judge.seenInputs.length = 0;
      resetThrottle();
    });

    it('runs only the published examples and writes nothing, for a guest', async () => {
      const token = await guestToken();
      const before = await rowCounts();
      const res = await post('/run', body(), token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        problemId: 1,
        language: 'python',
        passed: 1,
        total: 1,
        verdict: 'AC',
      });
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0]).toMatchObject({
        index: 0,
        input: { nums: [2, 7, 11, 15], target: 9 },
        status: 'AC',
        passed: true,
      });
      expect(judge.seenInputs).toEqual([{ nums: [2, 7, 11, 15], target: 9 }]);
      expect(JSON.stringify(res.body)).not.toContain(String(HIDDEN_INPUT));
      expect(await rowCounts()).toEqual(before);
    });

    it('writes nothing for a signed-in user either (no submission, score, progress or territory)', async () => {
      const before = await rowCounts();
      const res = await post('/run', body(), aliceToken);
      expect(res.status).toBe(200);
      expect(await rowCounts()).toEqual(before);
      expect(await redis.zscore('leaderboard:college', alice.id)).toBe('12.5');
    });

    it('reports a failing sample as a failure', async () => {
      const res = await post('/run', body({ code: 'WRONG' }), aliceToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ passed: 0, total: 1, verdict: 'WA' });
      expect(res.body.results[0].passed).toBe(false);
    });

    it('rejects what it should not run', async () => {
      const token = await guestToken();
      expect(
        (await post('/run', body({ language: 'ruby' }), token)).status,
      ).toBe(400);
      expect((await post('/run', body({ code: '' }), token)).status).toBe(400);
      expect(
        (await post('/run', body({ code: 'x'.repeat(20_001) }), token)).status,
      ).toBe(400);
      expect((await post('/run', body({ problemId: '1' }), token)).status).toBe(
        400,
      );
      expect((await post('/run', body({ problemId: 1.5 }), token)).status).toBe(
        400,
      );
      expect(
        (await post('/run', body({ userId: alice.id }), token)).status,
      ).toBe(400);
      expect((await post('/run', body({ testCases: [] }), token)).status).toBe(
        400,
      );
      expect(
        (await post('/run', body({ problemId: 99_999 }), token)).status,
      ).toBe(404);
      expect(judge.seenInputs).toEqual([]);
    });

    it('turns away a body bigger than the limit', async () => {
      const res = await post(
        '/run',
        body({ code: 'x'.repeat(100_000) }),
        await guestToken(),
      );
      expect(res.status).toBe(413);
    });

    it('lets a guest run 10 times a minute, then asks them to slow down', async () => {
      const token = await guestToken();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++)
        statuses.push((await post('/run', body(), token)).status);
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });

  // ------------------------------------------------------------------------
  describe('what responses contain', () => {
    const FORBIDDEN = [
      /testCases/,
      /test_cases/,
      /expected_output/,
      new RegExp(String(HIDDEN_INPUT)),
      new RegExp(String(HIDDEN_TARGET)),
      /passwordHash/i,
      /googleId/i,
      /google-alice/,
      /@thapar\.edu/,
      /tester@/,
      new RegExp(ALICE_CODE),
    ];

    const readable = (id: string) => [
      '/problems?limit=50',
      '/problems/1',
      '/territories',
      '/territories/grid',
      '/territories/owners',
      '/leaderboard/college?limit=50',
      '/leaderboard/me/rank',
      '/leaderboard/me/near-miss',
      '/users/alice',
      '/users/bob',
      '/auth/me',
      '/scoring/me',
      '/scoring/me/territories',
      '/scoring/me/daily-progress',
      '/scoring/me/streak',
      '/scoring/me/campaign-summary',
      '/submissions/me/status',
      '/contests/incoming',
      '/contests/outgoing',
      '/contests/active',
      ...(id === 'participant' ? [`/contests/${contestId}`] : []),
    ];

    it.each([
      ['alice', () => aliceToken, 'participant'],
      ['bob', () => bobToken, 'participant'],
      ['a guest', () => guestToken(), 'guest'],
    ])(
      "never contain hidden tests, other players' code or private account fields (%s)",
      async (_who, token, kind) => {
        const t = await token();
        for (const p of readable(kind)) {
          const res = await get(p, t);
          expect([p, res.status]).toEqual([p, 200]);
          const text = JSON.stringify(res.body);
          for (const pattern of FORBIDDEN)
            expect([p, pattern.test(text)]).toEqual([p, false]);
        }
      },
    );

    it('never contain a user id on the public pages: map, board, profile, problems', async () => {
      const t = await guestToken();
      for (const p of [
        '/territories',
        '/territories/grid',
        '/territories/owners',
        '/leaderboard/college?limit=50',
        '/users/alice',
        '/problems/1',
        '/problems?limit=50',
      ]) {
        const text = JSON.stringify((await get(p, t)).body);
        expect([p, text.includes(alice.id)]).toEqual([p, false]);
        expect([p, text.includes(bob.id)]).toEqual([p, false]);
      }
    });

    it("show the duel room to its two players without the other player's email or the hidden tests", async () => {
      const res = await get(`/contests/${contestId}`, aliceToken);
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(
        /testCases|test_cases|expected_output|@thapar|passwordHash|googleId/,
      );
      expect(text).not.toContain(String(HIDDEN_INPUT));
      expect(res.body.problem?.examples ?? res.body.problem).toBeDefined();
    });

    it('keep the duel room to the two players', async () => {
      const carol = await prisma.user.create({
        data: { email: 'carol.tester@thapar.edu', username: 'carol' },
      });
      const res = await get(
        `/contests/${contestId}`,
        await signToken(carol.id),
      );
      expect([403, 404]).toContain(res.status);
    });

    it('serve a problem page with starter code, examples and nothing else', async () => {
      const res = await get('/problems/1', aliceToken);
      expect(Object.keys(res.body).sort()).toEqual([
        'boilerplate',
        'constraints',
        'description',
        'difficultyLevel',
        'examples',
        'id',
        'title',
      ]);
      expect(Object.keys(res.body.boilerplate).sort()).toEqual([
        'c++',
        'python',
      ]);
    });

    it('give the leaderboard as username, score and isMe, from the refilled Redis board', async () => {
      const res = await get('/leaderboard/college?limit=50', bobToken);
      expect(res.body).toEqual([
        { username: 'alice', score: 12.5, isMe: false },
        { username: 'bob', score: 7.5, isMe: true },
      ]);
      expect((await get('/leaderboard/me/rank', bobToken)).body).toEqual({
        rank: 2,
      });
      expect(
        (await get('/leaderboard/me/near-miss', bobToken)).body,
      ).toMatchObject({ rank: 2, pointsToNext: 5, nextRankName: 'alice' });
    });

    it('give a public profile without ids or settings', async () => {
      const res = await get('/users/alice', bobToken);
      expect(Object.keys(res.body).sort()).toEqual([
        'cellsHeld',
        'isMe',
        'joinedAt',
        'problemsSolved',
        'territoriesHeld',
        'totalScore',
        'username',
      ]);
      expect(res.body).toMatchObject({
        username: 'alice',
        cellsHeld: 3,
        totalScore: 12.5,
        isMe: false,
      });
      expect((await get('/users/alice', aliceToken)).body.isMe).toBe(true);
      expect((await get('/users/nobody-here', aliceToken)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------
  describe('owner-only data', () => {
    let aliceSubmission: string;

    beforeAll(async () => {
      aliceSubmission = (
        await prisma.submission.findFirstOrThrow({
          where: { userId: alice.id },
        })
      ).id;
    });

    it('lets the owner read their own submission, without the user id', async () => {
      const res = await get(`/submissions/${aliceSubmission}`, aliceToken);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(aliceSubmission);
      expect(JSON.stringify(res.body)).not.toContain(alice.id);
    });

    it('hides it from everyone else as if it did not exist', async () => {
      expect(
        (await get(`/submissions/${aliceSubmission}`, bobToken)).status,
      ).toBe(404);
      expect(
        (await get(`/submissions/${aliceSubmission}`, await guestToken()))
          .status,
      ).toBe(404);
      expect(
        (await get(`/scoring/submission/${aliceSubmission}`, bobToken)).status,
      ).toBe(404);
      expect((await get(`/submissions/${aliceSubmission}`)).status).toBe(401);
    });

    it("only ever reports the caller's own progress", async () => {
      expect((await get('/submissions/me/status', aliceToken)).body).toEqual({
        1: 'AC',
      });
      expect((await get('/submissions/me/status', bobToken)).body).toEqual({
        1: 'AC',
      });
      // one entry per zone held, so the number of distinct zones their cells are in
      const zonesOf = async (cellIds: string[]) =>
        new Set(
          (
            await prisma.territoryCell.findMany({
              where: { id: { in: cellIds } },
            })
          ).map((c) => c.territoryId),
        ).size;
      expect(
        (await get('/scoring/me/territories', aliceToken)).body,
      ).toHaveLength(await zonesOf(aliceCells));
      expect(
        (await get('/scoring/me/territories', bobToken)).body,
      ).toHaveLength(await zonesOf(bobCells));
    });

    it('treats a malformed id as a bad request, not a crash', async () => {
      expect((await get('/submissions/not-a-uuid', aliceToken)).status).toBe(
        400,
      );
      expect((await get('/contests/not-a-uuid', aliceToken)).status).toBe(400);
      expect(
        (await get('/scoring/submission/not-a-uuid', aliceToken)).status,
      ).toBe(400);
    });
  });

  // ------------------------------------------------------------------------
  describe('the map', () => {
    it('lists the 46 zones with a slug, a name and a tier, and nothing else', async () => {
      const res = await get('/territories');
      expect(res.body).toHaveLength(46);
      for (const zone of res.body)
        expect(Object.keys(zone).sort()).toEqual([
          'id',
          'name',
          'svgPathId',
          'tier',
        ]);
    });

    it('serves the static grid compactly: 1000 cells, gzip, cacheable, revalidatable', async () => {
      const res = await get('/territories/grid', await guestToken()).set(
        'Accept-Encoding',
        'gzip',
      );
      expect(res.status).toBe(200);
      expect(res.body.gridVersion).toBe(2);
      expect(res.body.zones).toHaveLength(46);
      expect(res.body.cells).toHaveLength(1000);
      for (const cell of res.body.cells) {
        expect(cell).toHaveLength(4); // [id, zoneIndex, row, col]
        expect(typeof cell[0]).toBe('string');
        expect(cell[1]).toBeGreaterThanOrEqual(0);
        expect(cell[1]).toBeLessThan(46);
      }
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers.etag).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/owner|username|userId/i);

      const again = await get('/territories/grid', await guestToken()).set(
        'If-None-Match',
        res.headers.etag,
      );
      expect(again.status).toBe(304);
    });

    it('keeps the grid compact on the wire', async () => {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        guestToken().then((token) => {
          http
            .get(
              `${base}/territories/grid`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Accept-Encoding': 'gzip',
                },
              },
              (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
              },
            )
            .on('error', reject);
        }, reject);
      });
      // About 24 KB for 1000 cells, nearly all of it the random cell ids (16 KB of entropy). The old
      // payload for 554 cells was around 140 KB, uncompressed, and was refetched on every change.
      expect(raw.length).toBeLessThan(30_000);
    });

    it('tells each viewer which cells are theirs, and only by username', async () => {
      const grid = (await get('/territories/grid', aliceToken)).body;
      const idOf = (index: number) => grid.cells[index][0];
      for (const [token, mine, theirs] of [
        [aliceToken, 'alice', 'bob'],
        [bobToken, 'bob', 'alice'],
      ] as const) {
        const res = await get('/territories/owners', token);
        expect(res.status).toBe(200);
        expect(res.body.gridVersion).toBe(grid.gridVersion);
        expect(res.headers['cache-control']).toBe('private, no-cache');
        const byName = new Map<
          string,
          { username: string; color: string; isMe: boolean }
        >(
          res.body.owners.map(
            (o: { username: string; color: string; isMe: boolean }) => [
              o.username,
              o,
            ],
          ),
        );
        expect(byName.get(mine)?.isMe).toBe(true);
        expect(byName.get(theirs)?.isMe).toBe(false);
        expect(Object.keys(byName.get(mine) as object).sort()).toEqual([
          'color',
          'isMe',
          'username',
        ]);
        // [cellIndex, ownerIndex] pairs point at real cells
        const held = new Map<string, string>(
          res.body.held.map(([cell, owner]: [number, number]) => [
            idOf(cell),
            res.body.owners[owner].username,
          ]),
        );
        for (const id of aliceCells) expect(held.get(id)).toBe('alice');
        for (const id of bobCells) expect(held.get(id)).toBe('bob');
        expect(held.size).toBe(5);
      }
      const asGuest = await get('/territories/owners', await guestToken());
      expect(
        asGuest.body.owners.every((o: { isMe: boolean }) => o.isMe === false),
      ).toBe(true);
    });

    it('revalidates ownership with an ETag, so an unchanged map costs a 304', async () => {
      const first = await get('/territories/owners', aliceToken);
      expect(first.headers.etag).toBeTruthy();
      const second = await get('/territories/owners', aliceToken).set(
        'If-None-Match',
        first.headers.etag,
      );
      expect(second.status).toBe(304);
    });
  });

  // ------------------------------------------------------------------------
  describe('input handling', () => {
    it('answers a non-boolean setting with 400, not 500', async () => {
      expect(
        (
          await patch(
            '/auth/settings',
            { flavorTextEnabled: 'not-a-boolean' },
            aliceToken,
          )
        ).status,
      ).toBe(400);
      expect(
        (await patch('/auth/settings', { flavorTextEnabled: 1 }, aliceToken))
          .status,
      ).toBe(400);
      expect((await patch('/auth/settings', {}, aliceToken)).status).toBe(400);
      expect(
        (
          await patch(
            '/auth/settings',
            { flavorTextEnabled: false, admin: true },
            aliceToken,
          )
        ).status,
      ).toBe(400);
      const ok = await patch(
        '/auth/settings',
        { flavorTextEnabled: false },
        aliceToken,
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ flavorTextEnabled: false });
      await patch('/auth/settings', { flavorTextEnabled: true }, aliceToken);
    });

    it('answers a bad leaderboard limit with 400, not 500', async () => {
      for (const limit of ['abc', '0', '-1', '101', '1.5']) {
        expect([
          limit,
          (await get(`/leaderboard/college?limit=${limit}`, aliceToken)).status,
        ]).toEqual([limit, 400]);
      }
    });

    it('answers malformed JSON with a plain 400 that gives nothing away', async () => {
      const res = await request(base)
        .post('/auth/exchange')
        .set('Content-Type', 'application/json')
        .send('{"code": ');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(
        /at |node_modules|\/home\/|SyntaxError/,
      );
    });

    it("answers an unknown submission field, such as another user's id, with 400", async () => {
      const res = await post(
        '/submissions',
        { userId: bob.id, problemId: 2, language: 'python', code: 'print(1)' },
        aliceToken,
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/userId should not exist/);
    });

    it('answers a submission for a missing problem with 404, not 500', async () => {
      expect(
        (
          await post(
            '/submissions',
            { problemId: 999_999, language: 'python', code: 'print(1)' },
            aliceToken,
          )
        ).status,
      ).toBe(404);
    });

    it('turns away a body over the size limit before reading it', async () => {
      const res = await post(
        '/submissions',
        { problemId: 2, language: 'python', code: 'x'.repeat(200_000) },
        aliceToken,
      );
      expect(res.status).toBe(413);
    });
  });

  // ------------------------------------------------------------------------
  describe('headers and cross-origin rules', () => {
    it('sends security headers and hides the framework', async () => {
      const res = await get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-resource-policy']).toBeDefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it("allows the frontend's origin and nobody else's", async () => {
      const allowed = await get('/territories').set('Origin', ORIGIN);
      expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
      for (const origin of [
        'https://evil.example',
        `${ORIGIN}.evil.example`,
        'http://app.example.test',
        'null',
      ]) {
        const res = await get('/territories').set('Origin', origin);
        expect([origin, res.headers['access-control-allow-origin']]).toEqual([
          origin,
          undefined,
        ]);
      }
      const preflight = await request(base)
        .options('/auth/settings')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'PATCH');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      const okPreflight = await request(base)
        .options('/auth/settings')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(okPreflight.headers['access-control-allow-origin']).toBe(ORIGIN);
    });

    it('does not allow localhost in production', async () => {
      const local = 'http://localhost:5173';
      expect(
        (await get('/territories').set('Origin', local)).headers[
          'access-control-allow-origin'
        ],
      ).toBe(local);
      process.env.NODE_ENV = 'production';
      try {
        expect(
          (await get('/territories').set('Origin', local)).headers[
            'access-control-allow-origin'
          ],
        ).toBeUndefined();
        expect(
          (await get('/territories').set('Origin', ORIGIN)).headers[
            'access-control-allow-origin'
          ],
        ).toBe(ORIGIN);
      } finally {
        process.env.NODE_ENV = 'test';
      }
    });
  });

  // ------------------------------------------------------------------------
  describe('Google sign-in', () => {
    it('starts with a random state in both the redirect and an HttpOnly cookie', async () => {
      const res = await fetch(`${base}/auth/google`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') as string);
      expect(location.host).toBe('accounts.google.com');
      const state = location.searchParams.get('state') as string;
      expect(state.length).toBeGreaterThanOrEqual(30);
      expect(location.searchParams.get('hd')).toBe('thapar.edu');
      const cookie = res.headers.get('set-cookie') as string;
      expect(cookie).toContain(`cc_oauth_state=${state}`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/auth\/google/);
      const second = new URL(
        (
          await fetch(`${base}/auth/google`, { redirect: 'manual' })
        ).headers.get('location') as string,
      );
      expect(second.searchParams.get('state')).not.toBe(state);
    });

    it('turns a callback without the matching state into a login error and never into a token', async () => {
      for (const query of ['code=abc', 'code=abc&state=forged']) {
        const res = await fetch(`${base}/auth/google/callback?${query}`, {
          redirect: 'manual',
          headers: { Cookie: 'cc_oauth_state=something-else' },
        });
        expect(res.status).toBe(302);
        const location = res.headers.get('location') as string;
        expect(location).toBe(`${ORIGIN}/login?error=google_auth_failed`);
        expect(location).not.toMatch(/token|access/i);
      }
    });

    it('hands the access token over through a one-time code, once', async () => {
      const code = await issueLoginCode(alice.id);
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Redis holds only a hash of the code.
      const keys = await redis.keys('auth:code:*');
      expect(keys).toContain(
        `auth:code:${createHash('sha256').update(code).digest('hex')}`,
      );
      expect(keys.some((k) => k.includes(code))).toBe(false);

      const redeemed = await post('/auth/exchange', { code });
      expect(redeemed.status).toBe(200);
      expect(redeemed.body.role).toBe('USER');
      expect(
        (await get('/auth/me', redeemed.body.accessToken)).body.username,
      ).toBe('alice');

      expect((await post('/auth/exchange', { code })).status).toBe(401);
      expect(
        (
          await post('/auth/exchange', {
            code: randomBytes(32).toString('base64url'),
          })
        ).status,
      ).toBe(401);
      expect((await post('/auth/exchange', { code: 'short' })).status).toBe(
        400,
      );
      expect((await post('/auth/exchange', { code: ['a'] })).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------------
  describe('live updates (WebSocket)', () => {
    const open = (namespace: string, token?: string) =>
      io(`${base}${namespace}`, {
        auth: token === undefined ? {} : { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: { Origin: ORIGIN },
      });
    const outcome = (socket: Socket) =>
      new Promise<string>((resolve) => {
        socket.on('connect', () => resolve('connected'));
        socket.on('connect_error', (err) => resolve(`refused: ${err.message}`));
      }).finally(() => socket.close());

    it('refuses the map socket without a valid token', async () => {
      expect(await outcome(open('/'))).toMatch(/^refused/);
      expect(await outcome(open('/', 'garbage'))).toMatch(/^refused/);
      expect(
        await outcome(
          open(
            '/',
            jsonwebtoken.sign(
              { sub: alice.id, role: 'USER' },
              OLD_DEFAULT_SECRET,
            ),
          ),
        ),
      ).toMatch(/^refused/);
    });

    it('lets users and demo guests watch the map', async () => {
      expect(await outcome(open('/', aliceToken))).toBe('connected');
      expect(await outcome(open('/', await guestToken()))).toBe('connected');
    });

    it('keeps the duel socket for signed-in users', async () => {
      expect(await outcome(open('/contest'))).toMatch(/^refused/);
      expect(await outcome(open('/contest', await guestToken()))).toMatch(
        /^refused: forbidden/,
      );
      expect(await outcome(open('/contest', aliceToken))).toBe('connected');
    });
  });

  // ------------------------------------------------------------------------
  describe('a graded submission', () => {
    it('is judged from the database copy, not from what the queue carries, and moves the score and the map', async () => {
      const queue = app.get(getQueueToken('submissions')) as {
        add: (...args: unknown[]) => Promise<unknown>;
      };
      const jobs: unknown[] = [];
      const original = queue.add.bind(queue);
      const spy = jest
        .spyOn(queue, 'add')
        .mockImplementation((...args: unknown[]) => {
          jobs.push(args[1]);
          return original(...args);
        });
      try {
        const cellsBefore = await prisma.territoryCellOwnership.count({
          where: { userId: alice.id, closedAt: null },
        });
        const res = await post(
          '/submissions',
          {
            problemId: 2,
            language: 'python',
            code: 'def twoSum(nums, target):\n    return [0, 1]\n',
          },
          aliceToken,
        );
        expect(res.status).toBe(201);
        expect(Object.keys(res.body).sort()).toEqual([
          'createdAt',
          'id',
          'language',
          'noPointsReason',
          'pointsAwarded',
          'problemId',
          'totalPassed',
          'totalTests',
          'verdict',
        ]);
        expect(JSON.stringify(res.body)).not.toContain(alice.id);

        expect(jobs).toEqual([{ submissionId: res.body.id }]); // no code, no tests, no user id in Redis

        let verdict = 'PENDING';
        for (let i = 0; i < 100 && verdict === 'PENDING'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          verdict = (await get(`/submissions/${res.body.id}`, aliceToken)).body
            .verdict;
        }
        expect(verdict).toBe('AC');

        expect(
          await prisma.performanceScore.count({
            where: { submission: { userId: alice.id } },
          }),
        ).toBe(2);
        expect(
          await prisma.dailyProgress.count({ where: { userId: alice.id } }),
        ).toBe(1);
        expect(
          await prisma.territoryCellOwnership.count({
            where: { userId: alice.id, closedAt: null },
          }),
        ).toBe(cellsBefore + 1);
        expect(
          Number(await redis.zscore('leaderboard:college', alice.id)),
        ).toBeGreaterThan(12.5);
        expect((await get('/submissions/me/status', aliceToken)).body).toEqual({
          1: 'AC',
          2: 'AC',
        });
      } finally {
        spy.mockRestore();
      }
    });

    it("is always the token's user, never one named in the body", async () => {
      const res = await post(
        '/submissions',
        { userId: bob.id, problemId: 2, language: 'python', code: 'print(1)' },
        aliceToken,
      );
      expect(res.status).toBe(400);
      expect(
        await prisma.submission.count({
          where: { userId: bob.id, problemId: 2 },
        }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------------------
  describe('rate limits', () => {
    beforeEach(() => resetThrottle());

    it('limits demo sessions started from one address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 23; i++)
        statuses.push((await post('/auth/guest', {})).status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(20);
      expect(statuses.slice(20)).toEqual([429, 429, 429]);
    });

    it('limits sign-in attempts and code redemption', async () => {
      const login = [];
      for (let i = 0; i < 12; i++)
        login.push(
          (
            await post('/auth/login', {
              email: 'alice.tester@thapar.edu',
              password: `guess-${i}`,
            })
          ).status,
        );
      expect(login.slice(0, 10)).toEqual(Array(10).fill(403));
      expect(login.slice(10)).toEqual([429, 429]);
      const exchange = [];
      for (let i = 0; i < 22; i++)
        exchange.push(
          (
            await post('/auth/exchange', {
              code: randomBytes(32).toString('base64url'),
            })
          ).status,
        );
      expect(exchange.filter((s) => s === 401)).toHaveLength(20);
      expect(exchange.slice(20)).toEqual([429, 429]);
    });

    it('counts signed-in users one by one, not by shared address', async () => {
      const a = [];
      for (let i = 0; i < 12; i++)
        a.push(
          (
            await post(
              '/run',
              { problemId: 1, language: 'python', code: 'x' },
              aliceToken,
            )
          ).status,
        );
      expect(a.every((s) => s === 200)).toBe(true); // 30 a minute for a user
      expect(
        (
          await post(
            '/run',
            { problemId: 1, language: 'python', code: 'x' },
            bobToken,
          )
        ).status,
      ).toBe(200);
    });
  });

  // ------------------------------------------------------------------------
  describe('health', () => {
    it('reports ready when the database and Redis answer', async () => {
      const res = await get('/health/ready');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(
        /postgres(ql)?:\/\/|redis:\/\//,
      );
    });
  });
});
