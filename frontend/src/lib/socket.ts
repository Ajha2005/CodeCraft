import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

// Singleton pattern: one shared connection across the whole app,
// rather than each component opening its own socket. Matters once
// you have multiple components (map, leaderboard, notifications)
// all wanting to listen for the same server events.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
    });
  }
  return socket;
}

/**
 * The contest namespace needs its own connection per JWT (unlike the
 * always-on global socket above, which carries no auth) and is only ever
 * alive while a contest-related page is mounted — so this returns a fresh
 * socket per call instead of a shared singleton. Callers are responsible for
 * calling `.disconnect()` on unmount.
 */
export function createContestSocket(token: string): Socket {
  return io(`${SOCKET_URL}/contest`, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
