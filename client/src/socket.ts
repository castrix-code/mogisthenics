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
    // STUN for NAT discovery + a free TURN relay so video can traverse strict
    // NATs. Best-effort: if TURN is unavailable, ICE falls back to STUN/host
    // and the game still runs (gameplay is synced over Socket.io, not WebRTC).
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    },
  };
}
