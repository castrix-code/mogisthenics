import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CLIENT_URL may be a comma-separated allow-list. If unset, reflect any origin
// (fine for a casual cross-network test; tighten by setting CLIENT_URL in prod).
const corsOrigin: string[] | boolean = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((s) => s.trim())
  : true;

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

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

const generateRoomId = () => Math.random().toString(36).slice(2, 10);

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
      model: 'gemini-2.0-flash',
      contents: `A calisthenics athlete just ${ctx}. Give one specific, actionable coaching tip in 1-2 sentences. Be direct and encouraging.`,
      config: { maxOutputTokens: 120, temperature: 0.9 },
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

  socket.on('join_queue', async (data: { username: string; peerId: string; mode: GameModeId }) => {
    const mode: GameModeId = data.mode === 'pose_hold' ? 'pose_hold' : 'pushup_repoff';
    players.set(socket.id, { username: data.username || 'Anonymous', peerId: data.peerId, mode });

    // Register player on the leaderboard (idempotent)
    supabase.rpc('mog_register_player', { p_username: data.username || 'Anonymous' }).then(
      () => {},
      (e: unknown) => console.error('register error', e)
    );

    removeFromQueues(socket.id);
    const queue = queues[mode];

    if (queue.length > 0) {
      const partnerId = queue.shift()!;
      const me = players.get(socket.id)!;
      const partner = players.get(partnerId);
      if (!partner) {
        queue.push(socket.id);
        return socket.emit('waiting');
      }

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
      queue.push(socket.id);
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

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', queues: { pushup: queues.pushup_repoff.length, pose: queues.pose_hold.length }, rooms: rooms.size })
);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
