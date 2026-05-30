import { useEffect, useState, useCallback } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export interface LeaderboardEntry {
  username: string;
  elo: number;
  wins: number;
  losses: number;
  matches: number;
  best_pose_score: number;
}

interface Props {
  highlightUser?: string;
  refreshKey?: number;
  compact?: boolean;
}

export function Leaderboard({ highlightUser, refreshKey, compact }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const res = await fetch(`${SERVER_URL}/leaderboard`);
      const data = await res.json();
      setEntries(data.players || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-black text-white text-lg flex items-center gap-2">
          <span>🏆</span> Global Ranks
        </h3>
        <button onClick={load} className="text-xs text-zinc-500 hover:text-green-400 transition-colors">
          ↻ refresh
        </button>
      </div>

      {loading && <p className="text-zinc-500 text-sm py-4 text-center">Loading ranks…</p>}
      {error && <p className="text-red-400 text-sm py-4 text-center">Server offline — start the backend.</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-zinc-500 text-sm py-4 text-center">No ranked athletes yet. Be the first!</p>
      )}

      <div className="flex flex-col gap-1">
        {entries.slice(0, compact ? 5 : 50).map((e, i) => {
          const isMe = highlightUser && e.username === highlightUser;
          return (
            <div
              key={e.username}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                isMe ? 'bg-green-400/10 border border-green-400/40' : 'hover:bg-zinc-800'
              }`}
            >
              <span className="w-7 text-center font-bold text-zinc-400">{medal(i)}</span>
              <span className={`flex-1 font-semibold truncate ${isMe ? 'text-green-400' : 'text-white'}`}>
                {e.username}
              </span>
              {!compact && (
                <span className="text-xs text-zinc-500 tabular-nums">
                  {e.wins}W-{e.losses}L
                </span>
              )}
              <span className="font-black tabular-nums text-green-400 w-14 text-right">{e.elo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
