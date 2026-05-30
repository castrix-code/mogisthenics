import type { PoseTemplate } from './poses';

interface Props {
  pose: PoseTemplate;
  liveScore: number;
  perCheck: { label: string; score: number }[];
}

export function PoseGuide({ pose, liveScore, perCheck }: Props) {
  const ring = liveScore >= 80 ? '#00ff88' : liveScore >= 50 ? '#facc15' : '#ef4444';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 w-56 flex flex-col gap-3">
      <div className="text-center">
        <div className="text-4xl mb-1">{pose.emoji}</div>
        <div className="font-black text-white">{pose.name}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{pose.description}</div>
        <div className="mt-1 text-xs">
          {'⭐'.repeat(pose.difficulty)}
          <span className="text-zinc-600">{'⭐'.repeat(3 - pose.difficulty)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <div className="text-3xl font-black tabular-nums" style={{ color: ring }}>
          {liveScore}
          <span className="text-sm text-zinc-500">/100</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {perCheck.map((c) => (
          <div key={c.label}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-zinc-400">{c.label}</span>
              <span className="text-zinc-500 tabular-nums">{c.score}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${c.score}%`,
                  background: c.score >= 80 ? '#00ff88' : c.score >= 50 ? '#facc15' : '#ef4444',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
