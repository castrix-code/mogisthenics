import { io } from 'socket.io-client';
import type { PeerOptions } from 'peerjs';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Metered.live TURN service — credentials are issued dynamically via API.
// Set VITE_METERED_API_KEY in Vercel env vars (keep this out of source control).
const METERED_DOMAIN = import.meta.env.VITE_METERED_DOMAIN || 'mogisthenics.metered.live';
const METERED_API_KEY = import.meta.env.VITE_METERED_API_KEY || 'ee48e24da87fc53ef4d54b293b4bc9324a18';

export const socket = io(SERVER_URL, {
  autoConnect: false,
});

// Fetch short-lived TURN credentials from the Metered API.
// Falls back to openrelay if the fetch fails or no API key is configured.
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
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
  ];

  if (!METERED_API_KEY) {
    console.warn('[TURN] No VITE_METERED_API_KEY set — using openrelay fallback');
    return fallback;
  }

  try {
    const res = await fetch(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
    );
    if (!res.ok) throw new Error(`Metered API returned ${res.status}`);
    const servers = await res.json();
    if (!Array.isArray(servers) || servers.length === 0) throw new Error('Empty/invalid response');
    console.log('[TURN] Fetched', servers.length, 'ICE servers from metered.live ✓');
    return servers as RTCIceServer[];
  } catch (err) {
    console.error('[TURN] Metered fetch failed, using openrelay fallback:', err);
    return fallback;
  }
}

// Build PeerJS options with the provided ICE servers.
export function peerOptions(iceServers: RTCIceServer[]): PeerOptions {
  const url = new URL(SERVER_URL);
  const secure = url.protocol === 'https:';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path: '/peerjs',
    secure,
    debug: 2,
    config: { iceServers, iceCandidatePoolSize: 10 },
  };
}
