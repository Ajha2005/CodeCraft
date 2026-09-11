import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { ContestService } from './contest.service';

// How long a disconnected participant has to reconnect before they're
// auto-forfeited (Section 14.4 of the design doc). Kept in-memory (a Map of
// setTimeout handles) since this is a single-instance MVP — a multi-instance
// deployment would need this state in Redis instead, same caveat the rest of
// the gateway layer already has around horizontal scaling.
const GRACE_PERIOD_SECONDS = 30;

interface ContestSocketData {
  userId: string;
  contestIds: Set<string>;
}

type ContestSocket = Socket<any, any, any, ContestSocketData>;

@WebSocketGateway({
  namespace: 'contest',
  cors: { origin: '*' }, // TODO: restrict to actual frontend origin before deploying
})
export class ContestGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server<any, any, any, ContestSocketData>;

  private readonly logger = new Logger(ContestGateway.name);
  private readonly forfeitTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ContestService))
    private readonly contestService: ContestService,
  ) {}

  async handleConnection(client: ContestSocket) {
    const token = (client.handshake.auth?.token ??
      client.handshake.query?.token) as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
      }>(token, {
        secret: this.config.get<string>(
          'JWT_SECRET',
          'dev_secret_change_this_in_production',
        ),
      });
      client.data.userId = payload.sub;
      client.data.contestIds = new Set<string>();
      await client.join(`user:${payload.sub}`);
      this.logger.log(`Contest socket connected: user ${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: ContestSocket) {
    const userId = client.data?.userId;
    const contestIds = client.data?.contestIds;
    if (!userId || !contestIds) return;

    for (const contestId of contestIds) {
      this.scheduleForfeit(contestId, userId);
    }
  }

  @SubscribeMessage('contest:join')
  async handleJoin(
    @ConnectedSocket() client: ContestSocket,
    @MessageBody() body: { contestId: string },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body?.contestId) return;

    const contest = await this.prisma.contest.findUnique({
      where: { id: body.contestId },
    });
    if (
      !contest ||
      (contest.challengerId !== userId && contest.defenderId !== userId)
    ) {
      client.emit('contest:error', {
        message: 'Not a participant in this contest',
      });
      return;
    }

    await client.join(`contest:${body.contestId}`);
    client.data.contestIds.add(body.contestId);
    this.clearForfeitTimer(body.contestId, userId);

    if (contest.status === 'ACTIVE') {
      await this.prisma.contestParticipant.updateMany({
        where: { contestId: body.contestId, userId },
        data: { connected: true, disconnectedAt: null },
      });
    }

    this.broadcastToContest(body.contestId, 'contest:opponentStatus', {
      userId,
      connected: true,
    });
  }

  @SubscribeMessage('contest:leave')
  async handleLeave(
    @ConnectedSocket() client: ContestSocket,
    @MessageBody() body: { contestId: string },
  ) {
    if (!body?.contestId) return;
    await client.leave(`contest:${body.contestId}`);
    client.data?.contestIds?.delete(body.contestId);
  }

  private scheduleForfeit(contestId: string, userId: string) {
    const key = `${contestId}:${userId}`;
    if (this.forfeitTimers.has(key)) return;

    this.prisma.contestParticipant
      .updateMany({
        where: { contestId, userId },
        data: { connected: false, disconnectedAt: new Date() },
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to mark participant disconnected', err),
      );

    this.broadcastToContest(contestId, 'contest:opponentStatus', {
      userId,
      connected: false,
      graceSeconds: GRACE_PERIOD_SECONDS,
    });

    const timer = setTimeout(() => {
      this.forfeitTimers.delete(key);
      this.contestService
        .forfeit(contestId, userId)
        .catch((err: unknown) =>
          this.logger.error(
            `Forfeit resolution failed for contest ${contestId}`,
            err,
          ),
        );
    }, GRACE_PERIOD_SECONDS * 1000);

    this.forfeitTimers.set(key, timer);
  }

  private clearForfeitTimer(contestId: string, userId: string) {
    const key = `${contestId}:${userId}`;
    const timer = this.forfeitTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.forfeitTimers.delete(key);
    }
  }

  /** Push to one user's personal room — used for challenge notifications. */
  notifyUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /** Push to everyone currently in a contest room. */
  broadcastToContest(contestId: string, event: string, payload: unknown) {
    this.server.to(`contest:${contestId}`).emit(event, payload);
  }
}
