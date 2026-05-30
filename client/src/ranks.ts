// ── Rank tiers ────────────────────────────────────────────────────────────────
// Maps a player's ELO to a named tier. New players start at 1000 (Silver).

export interface RankTier {
  name: string;
  emoji: string;
  min: number; // inclusive ELO floor
  // Tailwind text + border/bg classes for the badge
  text: string;
  badge: string;
}

// Ordered high → low so the first match from the top wins.
const TIERS: RankTier[] = [
  { name: 'Diamond', emoji: '💎', min: 1300, text: 'text-cyan-300', badge: 'bg-cyan-400/10 border-cyan-400/40' },
  { name: 'Platinum', emoji: '🛡️', min: 1200, text: 'text-teal-300', badge: 'bg-teal-400/10 border-teal-400/40' },
  { name: 'Gold', emoji: '🥇', min: 1100, text: 'text-yellow-300', badge: 'bg-yellow-400/10 border-yellow-400/40' },
  { name: 'Silver', emoji: '🥈', min: 1000, text: 'text-zinc-200', badge: 'bg-zinc-400/10 border-zinc-400/40' },
  { name: 'Bronze', emoji: '🥉', min: 900, text: 'text-orange-300', badge: 'bg-orange-400/10 border-orange-400/40' },
  { name: 'Iron', emoji: '⛏️', min: 0, text: 'text-zinc-400', badge: 'bg-zinc-600/10 border-zinc-600/40' },
];

export function rankTier(elo: number): RankTier {
  return TIERS.find((t) => elo >= t.min) ?? TIERS[TIERS.length - 1];
}

// ELO needed to reach the next tier up, or null if already at the top.
export function nextTier(elo: number): RankTier | null {
  const idx = TIERS.findIndex((t) => elo >= t.min);
  return idx > 0 ? TIERS[idx - 1] : null;
}
