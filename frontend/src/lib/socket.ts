import { io, Socket } from 'socket.io-client';
import { readToken } from '../auth/session';

const SOCKET_URL = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

// Singleton pattern: one shared connection across the whole app,
// rather than each component opening its own socket. Matters once
// you have multiple components (map, leaderboard, notifications)
// all wanting to listen for the same server events.
//
// The server only accepts a socket that presents a valid access token (a signed-in
// player's or a demo guest's) in the handshake. The token is read each time the
// socket (re)connects, so a refreshed sign-in is picked up; `resetSocket` makes
// that happen right away when the player signs in or out.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelayMax: 30_000,
      auth: (give) => give({ token: readToken() }),
    });
  }
  return socket;
}

/** Drops the current connection and, if someone is signed in, opens a new one with their token. Listeners stay attached. */
export function resetSocket(): void {
  if (!socket) return;
  socket.disconnect();
  if (readToken()) socket.connect();
}

/**
 * The contest namespace needs its own connection per JWT and is only ever
 * alive while a contest-related page is mounted — so this returns a fresh
 * socket per call instead of a shared singleton. Callers are responsible for
 * calling `.disconnect()` on unmount. (Demo guests cannot join duels; the
 * server refuses them at the handshake.)
 */
export function createContestSocket(token: string): Socket {
  return io(`${SOCKET_URL}/contest`, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
