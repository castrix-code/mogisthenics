export interface RoundResult {
  youWon: boolean;
  draw: boolean;
  myScore: number;
  partnerScore: number;
  partnerName: string;
  eloBefore?: number;
  eloAfter?: number;
  coachingTip: string;
}

interface Props {
  result: RoundResult;
  scoreLabel: string; // 'reps' | 'form'
  solo?: boolean; // practice mode — no opponent, no ELO
  onNext: () => void;
  onHome: () => void;
}

export function ResultModal({ result, scoreLabel, solo, onNext, onHome }: Props) {
  const { youWon, draw, myScore, partnerScore, partnerName, eloBefore, eloAfter, coachingTip } = result;
  const eloDelta = eloAfter != null && eloBefore != null ? eloAfter - eloBefore : null;

  // ── Solo practice summary ───────────────────────────────────────────────────
  if (solo) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 px-4">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="text-5xl mb-3">🏋️</div>
          <h2 className="text-3xl font-black mb-1 text-green-400">Practice Done</h2>
          <p className="text-zinc-400 text-sm mb-6">No ranking — just reps. Nice work.</p>

          <div className="flex justify-center mb-6">
            <div>
              <div className="text-5xl font-black text-white">{myScore}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{scoreLabel}</div>
            </div>
          </div>

          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 mb-6 text-left">
            <div className="text-xs text-green-400 font-semibold mb-1 uppercase tracking-wide">AI Coach</div>
            <p className="text-zinc-200 text-sm leading-relaxed">{coachingTip}</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onHome}
              className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 font-semibold transition-colors"
            >
              Home
            </button>
            <button
              onClick={onNext}
              className="flex-1 py-3 rounded-xl bg-green-400 hover:bg-green-300 text-black font-black transition-colors"
            >
              Train Again →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
        <div className="text-5xl mb-3">{draw ? '🤝' : youWon ? '🏆' : '💪'}</div>
        <h2 className="text-3xl font-black mb-1">
          {draw ? (
            <span className="text-zinc-300">Dead Heat</span>
          ) : youWon ? (
            <span className="text-green-400">You Win!</span>
          ) : (
            <span className="text-zinc-300">Keep Training</span>
          )}
        </h2>
        <p className="text-zinc-400 text-sm mb-6">
          {draw ? 'Evenly matched.' : youWon ? 'Crushed it.' : "You'll get them next time."}
        </p>

        {/* ELO */}
        {eloAfter != null && (
          <div className="mb-5 flex items-center justify-center gap-2">
            <span className="text-zinc-500 text-sm">ELO</span>
            <span className="text-2xl font-black text-white tabular-nums">{eloAfter}</span>
            {eloDelta != null && (
              <span className={`text-sm font-bold ${eloDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {eloDelta >= 0 ? '+' : ''}{eloDelta}
              </span>
            )}
          </div>
        )}

        {/* Scores */}
        <div className="flex justify-center gap-8 mb-6">
          <div>
            <div className="text-4xl font-black text-white">{myScore}</div>
            <div className="text-xs text-zinc-500 mt-0.5">you · {scoreLabel}</div>
          </div>
          <div className="text-zinc-600 self-center font-black">vs</div>
          <div>
            <div className="text-4xl font-black text-zinc-400">{partnerScore}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{partnerName} · {scoreLabel}</div>
          </div>
        </div>

        {/* Coaching */}
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 mb-6 text-left">
          <div className="text-xs text-green-400 font-semibold mb-1 uppercase tracking-wide">AI Coach</div>
          <p className="text-zinc-200 text-sm leading-relaxed">{coachingTip}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onHome}
            className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 font-semibold transition-colors"
          >
            Home
          </button>
          <button
            onClick={onNext}
            className="flex-1 py-3 rounded-xl bg-green-400 hover:bg-green-300 text-black font-black transition-colors"
          >
            Next Partner →
          </button>
        </div>
      </div>
    </div>
  );
}
