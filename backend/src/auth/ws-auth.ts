import { JwtService } from '@nestjs/jwt';
import type { Server, Namespace, Socket } from 'socket.io';
import { AccessTokenPayload, AuthUser, userFromPayload } from './auth-user';

/** What the handshake middleware leaves on `socket.data`. */
export interface SocketData {
  user: AuthUser;
}

/**
 * Checks the access token sent in the Socket.IO handshake (`auth: { token }`,
 * never the query string, which ends up in proxy logs). Same signature, algorithm,
 * issuer and audience rules as the REST guard, because it is the same JwtService.
 */
export async function authenticateSocket(
  jwt: JwtService,
  token: unknown,
): Promise<AuthUser> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048)
    throw new Error('unauthorized');
  let payload: AccessTokenPayload;
  try {
    payload = await jwt.verifyAsync<AccessTokenPayload>(token);
  } catch {
    throw new Error('unauthorized');
  }
  const user = userFromPayload(payload);
  if (!user) throw new Error('unauthorized');
  return user;
}

/**
 * Installs the handshake check on a server or namespace: a connection without a
 * valid token is refused before it is established, so it never receives a
 * single event. `allowGuests` is false for the duel namespace.
 */
export function requireTokenOnHandshake(
  server: Server | Namespace,
  jwt: JwtService,
  allowGuests: boolean,
): void {
  server.use((socket: Socket, next: (err?: Error) => void) => {
    authenticateSocket(jwt, socket.handshake.auth?.token)
      .then((user) => {
        if (user.isGuest && !allowGuests) throw new Error('forbidden');
        (socket.data as SocketData).user = user;
        next();
      })
      .catch((err: Error) =>
        next(
          new Error(err.message === 'forbidden' ? 'forbidden' : 'unauthorized'),
        ),
      );
  });
}
