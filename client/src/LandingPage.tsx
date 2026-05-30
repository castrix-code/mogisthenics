import { useState } from 'react';
import { GAME_MODES, type GameModeId } from './poses';
import { Leaderboard } from './Leaderboard';

interface Props {
  onFindPartner: (username: string, mode: GameModeId) => void;
}

export function LandingPage({ onFindPartner }: Props) {
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<GameModeId>('pushup_repoff');

  const canStart = username.trim().length >= 2;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center px-6 py-12">
      {/* Title */}
      <div className="mb-8 select-none text-center">
        <h1 className="text-6xl font-black tracking-tight">
          <span className="text-white">Mogis</span>
          <span className="text-green-400">thenics</span>
        </h1>
        <p className="mt-3 text-zinc-400 text-lg font-medium">
          Omegle for calisthenics. Get matched. Compete. Climb the ranks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-4xl">
        {/* Left: setup */}
        <div className="flex flex-col gap-5">
          {/* Username */}
          <div>
            <label className="text-sm font-semibold text-zinc-400 mb-1.5 block">Your handle</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.slice(0, 20))}
              placeholder="e.g. plank_god"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white font-semibold placeholder-zinc-600 focus:outline-none focus:border-green-400 transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && canStart && onFindPartner(username.trim(), mode)}
            />
          </div>

          {/* Mode select */}
          <div>
            <label className="text-sm font-semibold text-zinc-400 mb-1.5 block">Game mode</label>
            <div className="flex flex-col gap-2">
              {(Object.values(GAME_MODES)).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`text-left rounded-xl px-4 py-3 border transition-all ${
                    mode === m.id
                      ? 'bg-green-400/10 border-green-400'
                      : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{m.emoji}</span>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        {m.name}
                        <span className="text-xs text-zinc-500 font-normal">{m.duration}s</span>
                      </div>
                      <div className="text-xs text-zinc-400">{m.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => onFindPartner(username.trim(), mode)}
            disabled={!canStart}
            className="bg-green-400 enabled:hover:bg-green-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-black text-xl px-10 py-4 rounded-2xl transition-all duration-150 enabled:active:scale-95 shadow-lg shadow-green-400/20"
          >
            Find a Partner →
          </button>
          <p className="text-zinc-600 text-xs text-center">
            Camera & mic required · Video is peer-to-peer · ELO ranked
          </p>
        </div>

        {/* Right: leaderboard */}
        <Leaderboard highlightUser={username.trim()} />
      </div>
    </div>
  );
}
