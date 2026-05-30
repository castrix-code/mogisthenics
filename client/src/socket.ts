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

  // TURN credentials: inject real ones via env vars for reliable video across
  // strict NATs (home broadband / mobile). Without a working TURN server,
  // WebRTC media fails for most pairs of real users.
  //
  //   VITE_TURN_URLS      comma-separated turn: URIs
  //   VITE_TURN_USERNAME  credential username
  //   VITE_TURN_CREDENTIAL  credential password
  //
  // Free options: https://www.metered.ca/tools/openrelay (sign up for API key)
  //               Cloudflare TURN (requires paid plan)
  //               Twilio Network Traversal Service (free trial)
  const turnUrls = import.meta.env.VITE_TURN_URLS
    ? import.meta.env.VITE_TURN_URLS.split(',').map((s: string) => s.trim())
    : null;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME ?? null;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL ?? null;

  // Always log the resolved TURN config so it's visible in DevTools → Console.
  // This makes it easy to confirm credentials are present in the production build.
  console.log('[TURN config]', {
    urls: turnUrls,
    username: turnUsername ? '(set)' : '(missing)',
    credential: turnCredential ? '(set)' : '(missing)',
  });

  // Build the iceServers list. If env-var TURN credentials are available, use
  // them as the primary relay. Always add openrelay as a hardcoded fallback so
  // there's at least one relay candidate even if Vercel env vars aren't set.
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Hardcoded openrelay as a guaranteed fallback relay.
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

  // If real TURN credentials are provided via env vars, prepend them so they
  // are tried first (they will be more reliable than the free fallback).
  if (turnUrls && turnUsername && turnCredential) {
    iceServers.unshift({ urls: turnUrls, username: turnUsername, credential: turnCredential });
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path: '/peerjs',
    secure,
    debug: 2, // always on so ICE negotiation is visible in DevTools console
    config: { iceServers, iceCandidatePoolSize: 10 },
  };
}
