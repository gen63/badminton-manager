import { Trash2, Heart } from 'lucide-react';
import type { Player } from '../types/player';
import type { Match } from '../types/match';
import type { PairPreference } from '../types/pairPreference';

interface PairPreferenceCardProps {
  preference: PairPreference;
  players: Player[];
  matchHistory: Match[];
  getPlayerName: (id: string) => string;
  onRemove: () => void;
}

/**
 * 2人が同じチーム（味方）だった試合数と、組み得た試合数の上限（機会）を求める。
 * 機会 = min(gamesPlayed)。plan 2026-08-31-pair-preference.md の 2. を参照。
 */
function computePairAchievement(
  playerAId: string,
  playerBId: string,
  matchHistory: Match[],
  players: Player[],
): { actual: number; opportunity: number } {
  const actual = matchHistory.filter((m) => {
    const inA = m.teamA.includes(playerAId) && m.teamA.includes(playerBId);
    const inB = m.teamB.includes(playerAId) && m.teamB.includes(playerBId);
    return inA || inB;
  }).length;

  const playerA = players.find((p) => p.id === playerAId);
  const playerB = players.find((p) => p.id === playerBId);
  const opportunity = Math.min(playerA?.gamesPlayed ?? 0, playerB?.gamesPlayed ?? 0);

  return { actual, opportunity };
}

export function PairPreferenceCard({
  preference,
  players,
  matchHistory,
  getPlayerName,
  onRemove,
}: PairPreferenceCardProps) {
  const [aId, bId] = preference.playerIds;
  const playerA = players.find((p) => p.id === aId);
  const playerB = players.find((p) => p.id === bId);
  const { actual, opportunity } = computePairAchievement(aId, bId, matchHistory, players);

  const nameColor = (player: Player | undefined) =>
    player?.gender === 'M'
      ? 'text-blue-700'
      : player?.gender === 'F'
      ? 'text-pink-700'
      : 'text-foreground';

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {/* 名前は truncate せず折り返す（docs/plans/2026-08-12-history-name-overflow.md
              で確立したパターン。見切れるより折り返す方を採る） */}
          <span className={`font-semibold text-sm min-w-0 break-words ${nameColor(playerA)}`}>
            {getPlayerName(aId)}
          </span>
          <span className="text-muted-foreground text-xs">＋</span>
          <span className={`font-semibold text-sm min-w-0 break-words ${nameColor(playerB)}`}>
            {getPlayerName(bId)}
          </span>
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
              preference.strength === 'strong'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {preference.strength === 'strong' && <Heart size={9} />}
            {preference.strength === 'strong' ? '必ず' : '普通'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {actual}/{opportunity}組
          </span>
          <button
            onClick={onRemove}
            aria-label="ペア希望を削除"
            className="w-7 h-7 shrink-0 rounded-full hover:bg-red-100 text-muted-foreground hover:text-red-600 flex items-center justify-center transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
