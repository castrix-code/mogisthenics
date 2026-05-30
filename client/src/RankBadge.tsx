import { rankTier } from './ranks';

interface Props {
  elo: number;
  showName?: boolean; // show the tier name, not just the emoji
  className?: string;
}

// A compact tier badge derived from a player's ELO.
export function RankBadge({ elo, showName, className = '' }: Props) {
  const tier = rankTier(elo);
  return (
    <span
      title={`${tier.name} · ${elo} ELO`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-bold ${tier.badge} ${tier.text} ${className}`}
    >
      <span>{tier.emoji}</span>
      {showName && <span>{tier.name}</span>}
    </span>
  );
}
