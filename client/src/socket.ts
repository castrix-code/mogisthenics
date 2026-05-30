import { io } from 'socket.io-client';
import type { PeerOptions } from 'peerjs';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket = io(SERVER_URL, {
  autoConnect: false,
});

// PeerJS options pointing at our self-hosted signaling server (mounted at
// /peerjs on the backend). Derived from VITE_SERVER_URL so it works in dev
// (http/3001) and prod (https/443) without extra config.
export function peerOptions(): PeerOptions {
  const url = new URL(SERVER_URL);
  const secure = url.protocol === 'https:';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path: '/peerjs',
    secure,
  };
}
