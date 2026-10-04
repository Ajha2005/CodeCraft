import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'socket.io';
import { requireTokenOnHandshake, SocketData } from '../auth/ws-auth';
import { isAllowedOrigin } from '../config/env';
import { TerritoryService } from './territory.service';

/** A cell changed hands. The owner's id is needed to work out `isMe` per client, and is never sent. */
export interface CellUpdate {
  territoryId: string;
  cellId: string;
  row: number;
  col: number;
  ownerUserId: string | null;
  ownerUsername: string | null;
  ownerColor: string;
}

@WebSocketGateway({
  // Same allowlist as the REST API: only the real frontend's origin, never "*".
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, isAllowedOrigin(origin)) },
})
export class TerritoryGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TerritoryGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly territories: TerritoryService,
  ) {}

  afterInit(server: Server) {
    // Demo (guest) sessions may watch the map, so guests are allowed here.
    requireTokenOnHandshake(server, this.jwt, true);
  }

  /**
   * Called whenever a cell changes owner. Each connected client gets its own
   * copy with `isMe` filled in, so no client ever sees (or needs) a user id.
   */
  async broadcastCellUpdate(update: CellUpdate): Promise<void> {
    const zone = await this.territories.zoneSlug(update.territoryId);
    for (const socket of this.server.sockets.sockets.values()) {
      const user = (socket.data as Partial<SocketData>).user;
      socket.emit('cell:updated', {
        cellId: update.cellId,
        zone,
        row: update.row,
        col: update.col,
        ownerUsername: update.ownerUsername,
        ownerColor: update.ownerColor,
        isMe: !!user && !user.isGuest && !!update.ownerUserId && user.userId === update.ownerUserId,
      });
    }
    this.logger.log(`Broadcast cell:updated for ${update.cellId}`);
  }

  /**
   * Called whenever a score changes (after any AC submission). The frontend
   * only uses it as a hint to refetch the leaderboard, so it names nobody.
   */
  broadcastLeaderboardUpdate() {
    this.server.emit('leaderboard:updated', {});
  }
}
