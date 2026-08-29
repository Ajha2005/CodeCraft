import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' }, // TODO: restrict to actual frontend origin before deploying
})
export class TerritoryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TerritoryGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Called whenever ownership changes. Broadcasts to every connected
   * client — no rooms needed since the whole map is shared/global,
   * unlike Phase 7's per-contest isolation.
   */
  broadcastTerritoryUpdate(payload: {
    territoryId: string;
    ownerId: string | null;
    ownerColor: string;
  }) {
    this.server.emit('territory:updated', payload);
    this.logger.log(`Broadcast territory:updated for ${payload.territoryId}`);
  }

  /**
   * Called whenever a user's cumulative score changes (after any AC
   * submission). Frontend uses this to know it should refetch the
   * leaderboard, rather than pushing full leaderboard data through
   * the socket on every single score change.
   */
  broadcastLeaderboardUpdate(payload: { userId: string; newScore: number }) {
    this.server.emit('leaderboard:updated', payload);
    this.logger.log(`Broadcast leaderboard:updated for user ${payload.userId}`);
  }
  broadcastCellUpdate(payload: {
  territoryId: string;
  cellId: string;
  row: number;
  col: number;
  ownerId: string | null;
  ownerColor: string;
}) {
  this.server.emit('cell:updated', payload);
  this.logger.log(`Broadcast cell:updated for ${payload.cellId} (territory ${payload.territoryId})`);
}
}
