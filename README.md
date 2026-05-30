# Mogisthenics 🤸

**Omegle for calisthenics.** Get matched with a random partner, compete in a live webcam
challenge, and climb a global ELO leaderboard.

## Features

- **Landing** — pick a handle + game mode, see the global ranks
- **Matchmaking** — Socket.io queue pairs two random users per game mode
- **Live P2P video** — side-by-side webcam via PeerJS (WebRTC)
- **Pose skeleton** — MediaPipe Pose drawn on a canvas over your feed
- **Two game modes:**
  - 💪 **Pushup Rep-Off** (60s) — elbow-angle rep counter + form score (back straightness + depth). Most reps wins.
  - 🤸 **Pose Hold** (15s) — hold a random skill pose (Elbow Lever, Frog Stand, L-Sit, Plank, Pistol Squat). Scored by a **joint-angle template** match. Best form wins.
- **Live sync** — reps/scores stream between both users via Socket.io
- **Round timer** with circular countdown; winner declared at zero
- **ELO leaderboard** — persisted in Supabase Postgres, standard ELO (K=32), atomic updates via a `security definer` RPC
- **AI coaching tip** — generated per-round by the Anthropic API (Claude Haiku) from your performance
- **Next Partner** — instantly requeue

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite + TailwindCSS v4 |
| Backend | Node + Express + TypeScript + Socket.io |
| Video | PeerJS (WebRTC) |
| Pose | MediaPipe Tasks Vision (PoseLandmarker) |
| DB | Supabase (Postgres) |
| AI | Anthropic API (Claude Haiku) |

## Setup

```bash
# Backend
cd server
cp .env.example .env      # fill in ANTHROPIC_API_KEY (Supabase is pre-filled)
npm install
npm run dev               # http://localhost:3001

# Frontend (separate terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

Open two browser windows (or two devices) to match with yourself.

## Environment

**server/.env**
```
ANTHROPIC_API_KEY=...      # required for coaching tips (falls back gracefully)
CLIENT_URL=http://localhost:5173
PORT=3001
SUPABASE_URL=...
SUPABASE_KEY=...           # publishable key
```

**client/.env**
```
VITE_SERVER_URL=http://localhost:3001
```

## Database

Tables (namespaced `mog_`): `mog_players`, `mog_matches`.
Logic functions: `mog_register_player(username)`, `mog_apply_match(mode, pose, a, b, score_a, score_b)`.
RLS allows public reads; all writes go through the `security definer` RPCs.

## How a match flows

1. Client gets camera → opens a PeerJS peer → `join_queue { username, peerId, mode }`
2. Server pairs two users in the same mode; for Pose Hold it picks a random pose and sends it in `matched`
3. Initiator places the WebRTC call; both render side-by-side
4. MediaPipe runs each frame → rep counter or pose scorer updates → `live_update` streams to the partner
5. Timer ends → each client emits `submit_score`; server collects both, calls `mog_apply_match` for authoritative ELO, asks Claude for a coaching tip, and emits `round_result`
6. **Next Partner** requeues with the same handle
