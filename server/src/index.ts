import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { ExpressPeerServer } from 'peer';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CLIENT_URL may be a comma-separated allow-list. Matching is tolerant of a
// trailing slash, and any *.vercel.app origin is allowed (covers preview URLs).
// If CLIENT_URL is unset entirely, every origin is reflected (casual test mode).
const allowList = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

type OriginCb = (err: Error | null, allow?: boolean) => void;
function corsOrigin(origin: string | undefined, cb: OriginCb) {
  if (!origin) return cb(null, true); // same-origin / curl / server-to-server
  const normalized = origin.replace(/\/+$/, '');
  if (allowList.length === 0) return cb(null, true);
  if (allowList.includes(normalized) || normalized.endsWith('.vercel.app')) {
    return cb(null, true);
  }
  return cb(null, false);
}

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// Self-hosted PeerJS signaling server (the public 0.peerjs.com broker is
// unreliable). Clients connect to this at path /peerjs over wss.
const peerServer = ExpressPeerServer(httpServer, { path: '/' });
app.use('/peerjs', peerServer);

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

// ── Types & state ────────────────────────────────────────────────────────────
type GameModeId = 'pushup_repoff' | 'pose_hold';

const POSE_IDS = ['elbow_lever', 'frog_stand', 'l_sit', 'plank', 'pistol_squat'];

interface Player {
  username: string;
  peerId: string;
  mode: GameModeId;
}

interface Room {
  members: [string, string];
  mode: GameModeId;
  pose: string | null;
  scores: Record<string, number>; // socketId -> final score
  resolved: boolean;
}

// One queue per mode
const queues: Record<GameModeId, string[]> = {
  pushup_repoff: [],
  pose_hold: [],
};
const players = new Map<string, Player>(); // socketId -> Player
const rooms = new Map<string, Room>();

// Lobby auth/presence (separate from in-match `players`): an authenticated
// socket maps to a verified username, and each username may have several sockets
// (multiple tabs). Used for the friends list + live challenge routing.
const socketUser = new Map<string, string>(); // socketId -> username
const online = new Map<string, Set<string>>(); // username -> socketIds

// One outstanding incoming challenge per user (keyed by the challenged user).
interface PendingChallenge {
  fromUser: string;
  fromSocket: string;
  fromPeerId: string;
  mode: GameModeId;
}
const pendingChallenges = new Map<string, PendingChallenge>(); // addressee -> challenge

const socketsFor = (username: string): string[] => Array.from(online.get(username) ?? []);
const isOnline = (username: string): boolean => (online.get(username)?.size ?? 0) > 0;

const generateRoomId = () => Math.random().toString(36).slice(2, 10);

// Push a fresh friends + incoming-requests snapshot to one socket.
async function emitFriendData(socketId: string, username: string) {
  try {
    const [friendsRes, reqRes] = await Promise.all([
      supabase.rpc('mog_list_friends', { p_user: username }),
      supabase.rpc('mog_list_friend_requests', { p_user: username }),
    ]);
    const friends = (friendsRes.data ?? []).map((f: { username: string }) => ({
      ...f,
      online: isOnline(f.username),
    }));
    io.to(socketId).emit('friends_data', { friends, requests: reqRes.data ?? [] });
  } catch (e) {
    console.error('friends_data error:', e);
  }
}

// Refresh every connected socket belonging to a user.
async function refreshUser(username: string) {
  for (const sid of socketsFor(username)) await emitFriendData(sid, username);
}

// Tell a user's online friends that their presence changed.
async function broadcastPresence(username: string, isOnlineNow: boolean) {
  try {
    const { data } = await supabase.rpc('mog_list_friends', { p_user: username });
    for (const f of (data ?? []) as { username: string }[]) {
      for (const sid of socketsFor(f.username)) {
        io.to(sid).emit('friend_presence', { username, online: isOnlineNow });
      }
    }
  } catch (e) {
    console.error('presence error:', e);
  }
}

// Verify a Supabase access token and return the player's *real* username from
// their auth profile. The client can lie about its username, so the leaderboard
// must only ever trust the name baked into a validly-signed JWT. Returns null
// for missing/invalid/expired tokens or accounts without a username.
async function verifyUsername(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    const username = (data.user.user_metadata as { username?: string } | null)?.username;
    return typeof username === 'string' && username.trim().length >= 2 ? username.trim() : null;
  } catch (e) {
    console.error('auth verify failed:', e);
    return null;
  }
}

function findRoom(socketId: string): [string, Room] | null {
  for (const [id, room] of rooms) {
    if (room.members.includes(socketId)) return [id, room];
  }
  return null;
}

function partnerOf(socketId: string, room: Room): string {
  return room.members[0] === socketId ? room.members[1] : room.members[0];
}

function removeFromQueues(socketId: string) {
  (Object.keys(queues) as GameModeId[]).forEach((m) => {
    const i = queues[m].indexOf(socketId);
    if (i !== -1) queues[m].splice(i, 1);
  });
}

// Pull the next genuinely matchable partner from a queue: a socket that is
// still connected, known, not the joiner, and not already in a room. Dead or
// stale entries are discarded so we never "match" a ghost.
function nextLivePartner(mode: GameModeId, selfId: string): string | null {
  const queue = queues[mode];
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    if (
      candidate !== selfId &&
      io.sockets.sockets.has(candidate) &&
      players.has(candidate) &&
      !findRoom(candidate)
    ) {
      return candidate;
    }
    // candidate is stale — drop its leftover player record
    players.delete(candidate);
  }
  return null;
}

// ── ELO + match recording via Supabase RPC ───────────────────────────────────
async function applyMatch(room: Room) {
  if (room.resolved) return;
  room.resolved = true;

  const [a, b] = room.members;
  const pa = players.get(a);
  const pb = players.get(b);
  if (!pa || !pb) return;

  const scoreA = room.scores[a] ?? 0;
  const scoreB = room.scores[b] ?? 0;

  let eloResult: any = null;
  try {
    const { data, error } = await supabase.rpc('mog_apply_match', {
      p_mode: room.mode,
      p_pose: room.pose,
      p_player_a: pa.username,
      p_player_b: pb.username,
      p_score_a: scoreA,
      p_score_b: scoreB,
    });
    if (error) console.error('mog_apply_match error:', error.message);
    eloResult = data;
  } catch (e) {
    console.error('Supabase RPC failed:', e);
  }

  const winnerUsername: string | null = eloResult?.winner ?? null;

  const tip = await coachingTip(room.mode, room.pose, scoreA);
  const tipB = await coachingTip(room.mode, room.pose, scoreB);

  io.to(a).emit('round_result', {
    youWon: winnerUsername === pa.username,
    draw: winnerUsername === null,
    myScore: scoreA,
    partnerScore: scoreB,
    partnerName: pb.username,
    eloBefore: eloResult?.elo_a_before,
    eloAfter: eloResult?.elo_a_after,
    coachingTip: tip,
  });
  io.to(b).emit('round_result', {
    youWon: winnerUsername === pb.username,
    draw: winnerUsername === null,
    myScore: scoreB,
    partnerScore: scoreA,
    partnerName: pa.username,
    eloBefore: eloResult?.elo_b_before,
    eloAfter: eloResult?.elo_b_after,
    coachingTip: tipB,
  });
}

async function coachingTip(mode: GameModeId, pose: string | null, score: number): Promise<string> {
  const ctx =
    mode === 'pushup_repoff'
      ? `completed a 60-second pushup rep-off with ${score} reps`
      : `held a ${pose?.replace('_', ' ')} pose for 15 seconds with a form match score of ${score}/100`;
  try {
    const res = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `A calisthenics athlete just ${ctx}. Give one specific, actionable coaching tip in 1-2 sentences. Be direct and encouraging.`,
      // thinkingBudget: 0 disables the model's reasoning pass so the whole
      // token budget goes to the visible tip (faster + cheaper for one-liners).
      config: { maxOutputTokens: 150, temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = res.text?.trim();
    if (text) return text;
  } catch (e) {
    console.error('Gemini error:', e);
  }
  return 'Keep your core braced and movements controlled — consistency beats intensity.';
}

// ── Socket handlers ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ── Lobby auth: identify the socket so friend/challenge actions are trusted ──
  socket.on('authenticate', async (data: { token?: string }) => {
    const username = await verifyUsername(data.token);
    if (!username) {
      socket.emit('auth_error', 'Session expired — log in again.');
      return;
    }
    socketUser.set(socket.id, username);
    if (!online.has(username)) online.set(username, new Set());
    online.get(username)!.add(socket.id);

    // Make sure the player exists for friend lookups (idempotent).
    supabase.rpc('mog_register_player', { p_username: username }).then(
      () => {},
      (e: unknown) => console.error('register error', e)
    );

    socket.emit('authenticated', { username });
    await emitFriendData(socket.id, username);
    await broadcastPresence(username, true);
  });

  socket.on('friends_refresh', async () => {
    const username = socketUser.get(socket.id);
    if (username) await emitFriendData(socket.id, username);
  });

  socket.on('friend_request', async (data: { to: string }) => {
    const from = socketUser.get(socket.id);
    const to = (data.to || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!from || !to) return;
    try {
      const { data: result } = await supabase.rpc('mog_send_friend_request', { p_from: from, p_to: to });
      const status: string = result?.status ?? 'error';
      socket.emit('friend_request_result', { to, status });
      if (status === 'requested' || status === 'accepted') {
        await refreshUser(from); // outgoing/accepted may change our list
        await refreshUser(to); // they get a new pending request (or a new friend)
      }
    } catch (e) {
      console.error('friend_request error:', e);
      socket.emit('friend_request_result', { to, status: 'error' });
    }
  });

  socket.on('friend_respond', async (data: { from: string; accept: boolean }) => {
    const user = socketUser.get(socket.id);
    if (!user || !data.from) return;
    try {
      await supabase.rpc('mog_respond_friend_request', {
        p_user: user,
        p_from: data.from,
        p_accept: !!data.accept,
      });
      await refreshUser(user);
      await refreshUser(data.from);
    } catch (e) {
      console.error('friend_respond error:', e);
    }
  });

  // ── Direct challenge a friend (live) ──────────────────────────────────────
  socket.on('challenge_friend', async (data: { to: string; mode: GameModeId; peerId: string }) => {
    const from = socketUser.get(socket.id);
    if (!from) return;
    const to = (data.to || '').trim();
    const mode: GameModeId = data.mode === 'pose_hold' ? 'pose_hold' : 'pushup_repoff';
    if (!isOnline(to)) {
      socket.emit('challenge_failed', { to, reason: 'offline' });
      return;
    }
    pendingChallenges.set(to, { fromUser: from, fromSocket: socket.id, fromPeerId: data.peerId, mode });
    for (const sid of socketsFor(to)) {
      io.to(sid).emit('challenge_received', { from, mode });
    }
    // Auto-expire so a stuck challenge doesn't trap the challenger forever.
    setTimeout(() => {
      const p = pendingChallenges.get(to);
      if (p && p.fromSocket === socket.id) {
        pendingChallenges.delete(to);
        socket.emit('challenge_expired', { to });
      }
    }, 30000);
  });

  socket.on('challenge_accept', async (data: { from: string; peerId: string }) => {
    const me = socketUser.get(socket.id);
    if (!me) return;
    const challenge = pendingChallenges.get(me);
    if (!challenge || challenge.fromUser !== data.from || !io.sockets.sockets.has(challenge.fromSocket)) {
      socket.emit('challenge_failed', { to: data.from, reason: 'expired' });
      pendingChallenges.delete(me);
      return;
    }
    pendingChallenges.delete(me);

    const { fromSocket, fromPeerId, mode } = challenge;
    const roomId = generateRoomId();
    const pose = mode === 'pose_hold' ? POSE_IDS[Math.floor(Math.random() * POSE_IDS.length)] : null;

    players.set(fromSocket, { username: challenge.fromUser, peerId: fromPeerId, mode });
    players.set(socket.id, { username: me, peerId: data.peerId, mode });
    rooms.set(roomId, { members: [fromSocket, socket.id], mode, pose, scores: {}, resolved: false });

    io.sockets.sockets.get(fromSocket)?.join(roomId);
    socket.join(roomId);

    // Challenger initiates the WebRTC call (same contract as matchmaking).
    io.to(fromSocket).emit('matched', {
      mode, pose, partnerPeerId: data.peerId, partnerName: me, initiator: true,
    });
    socket.emit('matched', {
      mode, pose, partnerPeerId: fromPeerId, partnerName: challenge.fromUser, initiator: false,
    });
    console.log(`[=] ${roomId} challenge (${mode}${pose ? '/' + pose : ''}): ${challenge.fromUser} vs ${me}`);
  });

  socket.on('cancel_challenge', () => {
    for (const [addressee, c] of pendingChallenges) {
      if (c.fromSocket === socket.id) {
        pendingChallenges.delete(addressee);
        for (const sid of socketsFor(addressee)) io.to(sid).emit('challenge_canceled');
      }
    }
  });

  socket.on('challenge_decline', (data: { from: string }) => {
    const me = socketUser.get(socket.id);
    if (!me) return;
    const challenge = pendingChallenges.get(me);
    if (challenge && challenge.fromUser === data.from) {
      pendingChallenges.delete(me);
      io.to(challenge.fromSocket).emit('challenge_declined', { by: me });
    }
  });

  socket.on('join_queue', async (data: { token?: string; username?: string; peerId: string; mode: GameModeId }) => {
    // Only authenticated accounts may join ranked matchmaking — this is what
    // keeps fake/spoofed usernames off the leaderboard. The username comes from
    // the already-authenticated socket (or the token), never the client field.
    const username = socketUser.get(socket.id) ?? (await verifyUsername(data.token));
    if (!username) {
      socket.emit('auth_error', 'Log in to play ranked matches.');
      return;
    }

    const mode: GameModeId = data.mode === 'pose_hold' ? 'pose_hold' : 'pushup_repoff';
    players.set(socket.id, { username, peerId: data.peerId, mode });

    // Register player on the leaderboard (idempotent)
    supabase.rpc('mog_register_player', { p_username: username }).then(
      () => {},
      (e: unknown) => console.error('register error', e)
    );

    removeFromQueues(socket.id);
    // If the joiner is somehow still attached to an old room, tear it down.
    const stale = findRoom(socket.id);
    if (stale) {
      io.to(partnerOf(socket.id, stale[1])).emit('partner_left');
      rooms.delete(stale[0]);
    }

    const partnerId = nextLivePartner(mode, socket.id);

    if (partnerId) {
      const me = players.get(socket.id)!;
      const partner = players.get(partnerId)!;

      const roomId = generateRoomId();
      const pose = mode === 'pose_hold' ? POSE_IDS[Math.floor(Math.random() * POSE_IDS.length)] : null;
      rooms.set(roomId, { members: [partnerId, socket.id], mode, pose, scores: {}, resolved: false });

      socket.join(roomId);
      io.sockets.sockets.get(partnerId)?.join(roomId);

      io.to(partnerId).emit('matched', {
        mode, pose, partnerPeerId: me.peerId, partnerName: me.username, initiator: true,
      });
      socket.emit('matched', {
        mode, pose, partnerPeerId: partner.peerId, partnerName: partner.username, initiator: false,
      });
      console.log(`[=] ${roomId} (${mode}${pose ? '/' + pose : ''}): ${partner.username} vs ${me.username}`);
    } else {
      queues[mode].push(socket.id);
      socket.emit('waiting');
    }
  });

  socket.on('leave_queue', () => removeFromQueues(socket.id));

  // Live rep/score broadcast to partner (display only)
  socket.on('live_update', (data: { value: number; secondary: number }) => {
    const found = findRoom(socket.id);
    if (!found) return;
    io.to(partnerOf(socket.id, found[1])).emit('partner_live_update', data);
  });

  // Authoritative final score submission — ELO applied once both arrive
  socket.on('submit_score', async (data: { score: number }) => {
    const found = findRoom(socket.id);
    if (!found) return;
    const [, room] = found;
    room.scores[socket.id] = data.score;

    const partner = partnerOf(socket.id, room);
    const bothIn = room.scores[socket.id] !== undefined && room.scores[partner] !== undefined;

    if (bothIn) {
      await applyMatch(room);
    } else {
      // Give the partner a short grace window, then resolve with what we have
      setTimeout(() => {
        if (!room.resolved) applyMatch(room);
      }, 5000);
    }
  });

  socket.on('next_partner', () => {
    const found = findRoom(socket.id);
    if (found) {
      const [id, room] = found;
      io.to(partnerOf(socket.id, room)).emit('partner_left');
      rooms.delete(id);
      socket.leave(id);
    }
  });

  socket.on('disconnect', () => {
    removeFromQueues(socket.id);
    const found = findRoom(socket.id);
    if (found) {
      const [id, room] = found;
      io.to(partnerOf(socket.id, room)).emit('partner_left');
      rooms.delete(id);
    }
    players.delete(socket.id);

    // Lobby cleanup: drop presence, expire any challenge this socket was party
    // to, and tell friends if the user went fully offline.
    const username = socketUser.get(socket.id);
    if (username) {
      socketUser.delete(socket.id);
      const set = online.get(username);
      set?.delete(socket.id);
      if (set && set.size === 0) {
        online.delete(username);
        void broadcastPresence(username, false);
      }
      // I was the challenged user → forget the incoming challenge.
      pendingChallenges.delete(username);
    }
    // I was the challenger → cancel and notify the target.
    for (const [addressee, c] of pendingChallenges) {
      if (c.fromSocket === socket.id) {
        pendingChallenges.delete(addressee);
        for (const sid of socketsFor(addressee)) io.to(sid).emit('challenge_canceled');
      }
    }

    console.log(`[-] ${socket.id} disconnected`);
  });
});

// ── REST: leaderboard ─────────────────────────────────────────────────────────
app.get('/leaderboard', async (_req, res) => {
  const { data, error } = await supabase
    .from('mog_players')
    .select('username, elo, wins, losses, matches, best_pose_score')
    .order('elo', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ players: data });
});

// A single player's stats (for the lobby account card / rank tier). Returns
// null when the player hasn't been registered yet.
app.get('/player/:username', async (req, res) => {
  const { data, error } = await supabase
    .from('mog_players')
    .select('username, elo, wins, losses, matches, best_pose_score')
    .eq('username', req.params.username)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ player: data });
});

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', queues: { pushup: queues.pushup_repoff.length, pose: queues.pose_hold.length }, rooms: rooms.size })
);

// Friendly root so visiting the API host directly doesn't look broken.
app.get('/', (_req, res) =>
  res.send(
    'Mogisthenics API is running 💪 — this is the backend, not the app. ' +
      'Play at https://mogisthenics.vercel.app'
  )
);

// Periodic sweep: drop rooms whose members have both vanished, and prune dead
// socket IDs from the queues, so stale state can't corrupt matchmaking.
setInterval(() => {
  for (const [id, room] of rooms) {
    const [a, b] = room.members;
    if (!io.sockets.sockets.has(a) && !io.sockets.sockets.has(b)) rooms.delete(id);
  }
  (Object.keys(queues) as GameModeId[]).forEach((m) => {
    queues[m] = queues[m].filter((sid) => io.sockets.sockets.has(sid));
  });
}, 20000);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
