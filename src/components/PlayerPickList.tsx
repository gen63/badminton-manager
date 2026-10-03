import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Player } from '../types/player';
import { usePlayerGameStats } from '../hooks/usePlayerGameStats';
import { GameSortToggle } from './GameSortToggle';
import { GameStatsRows } from './GameStatsRows';
import { sortPlayersByExpectedDiff, sortPlayersBySinceLastGame } from '../lib/playerSort';
import type { GameSortMode } from '../lib/playerStats';
import { getReservationPickState, RESERVATION_EXPECTED_DIFF_LIMIT } from '../lib/reservationGate';

interface PlayerPickListProps {
  players: Player[];
  getPlayerName: (id: string) => string;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  /**
   * true のとき、期待差 / 経過時間の切替ボタンと各行の試合数・期待差（または前回の試合からの経過）を出し、
   * 待機中→休憩中の中をその順で並べる（本人の最上部固定はしない）。既定 false は従来の見た目・並び。
   */
  showGameStats?: boolean;
  /**
   * 予約追加用の期待差ゲート（`showGameStats` と併用）。期待差 ≥ B（RESERVATION_EXPECTED_DIFF_LIMIT）のメンバーは、
   * 作成者以外は選択不可（グレー・タップ不可）、作成者は選択できるが注意表示（保留される）を出す。
   * 期待が算出できない人は制限しない。docs/plans/2026-10-03-reservation-expected-diff-gate.md
   */
  reservationGate?: { isCreator: boolean };
}

/**
 * モーダル内のプレイヤー選択リスト。
 * 名前・性別バッジ・休憩中バッジ・選択時のスタイルと、待機中→休憩中の並び替えを担う。
 * `ReservationAddModal` と `PairPreferenceAddModal` の共通部分を切り出したもの。
 * 選択状態の持ち方（Set / 配列）は呼び出し側に委ねるため `isSelected` / `onToggle` を props で受け取る。
 */
export function PlayerPickList({ players, getPlayerName, isSelected, onToggle, showGameStats = false, reservationGate }: PlayerPickListProps) {
  const { now, expectedById, stayById, inCourtIds, useStayDurationPriority } = usePlayerGameStats(players);
  // 並び順の切替（永続化しない）。既定は期待差
  const [sortMode, setSortMode] = useState<GameSortMode>('expected');

  // showGameStats 時は期待差 / 経過時間の順（本人固定なし）に並べてから、待機中→休憩中に安定ソートする
  const ordered = showGameStats
    ? (sortMode === 'lastGame'
        ? sortPlayersBySinceLastGame(players, inCourtIds, now, null)
        : sortPlayersByExpectedDiff(players, expectedById, null)
      ).others
    : players;
  // 待機中→休憩中の順で表示（Array.prototype.sort は安定なので、中の順序は ordered のまま）
  const sortedPlayers = [...ordered].sort((a, b) => {
    if (a.isResting !== b.isResting) return a.isResting ? 1 : -1;
    return 0;
  });

  return (
    <div className="p-4 flex flex-col gap-2">
      {showGameStats && <GameSortToggle value={sortMode} onChange={setSortMode} />}
      {sortedPlayers.map((player) => {
        const selected = isSelected(player.id);
        const pickState = showGameStats && reservationGate
          ? getReservationPickState(
              expectedById.get(player.id)?.diff,
              reservationGate.isCreator,
            )
          : 'free';
        // 選択済みなら解除だけはできるよう、未選択のときに限り不可にする
        const blocked = pickState === 'blocked' && !selected;
        const textColor = player.gender === 'M'
          ? 'text-blue-600'
          : player.gender === 'F'
          ? 'text-pink-600'
          : 'text-foreground';

        const nameRow = (
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className={`font-semibold text-sm min-w-0 break-words ${player.isResting ? 'text-muted-foreground' : textColor}`}>
                {getPlayerName(player.id)}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                player.gender === 'M'
                  ? 'bg-blue-100 text-blue-700'
                  : player.gender === 'F'
                  ? 'bg-pink-100 text-pink-700'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {player.gender === 'M' ? '男' : player.gender === 'F' ? '女' : '-'}
              </span>
              {player.isResting && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                  休憩中
                </span>
              )}
              {blocked && (
                <span className="basis-full text-[10px] font-semibold text-red-600">
                  期待差+{RESERVATION_EXPECTED_DIFF_LIMIT}以上のため予約不可
                </span>
              )}
              {pickState === 'warn' && (
                <span className="basis-full text-[10px] font-semibold text-amber-600">
                  期待差+{RESERVATION_EXPECTED_DIFF_LIMIT}以上（保留されます）
                </span>
              )}
            </div>
        );

        return (
          <button
            key={player.id}
            onClick={() => onToggle(player.id)}
            disabled={blocked}
            aria-disabled={blocked}
            className={`relative flex items-center justify-between border-2 p-3 rounded-xl transition-all shadow-sm ${
              blocked ? 'opacity-50 grayscale cursor-not-allowed bg-muted/40 border-border' : 'active:scale-95'
            } ${
              blocked ? '' : selected
                ? 'bg-green-50 border-green-500'
                : player.isResting
                ? 'bg-muted/30 border-border'
                : 'bg-card border-border'
            }`}
          >
            {/* 名前が長くてもバッジやチェックを押し出さないよう、折り返しを許す
                （min-w-0 が無いと flex アイテムが縮まない）。truncate は使わない
                — docs/plans/2026-08-12-history-name-overflow.md の方針 */}
            {showGameStats ? (
              <GameStatsRows
                gamesPlayed={player.gamesPlayed}
                sortMode={sortMode}
                stay={useStayDurationPriority ? stayById.get(player.id) : undefined}
                expected={expectedById.get(player.id)}
                lastPlayedAt={player.lastPlayedAt}
                inCourt={inCourtIds.has(player.id)}
                now={now}
              >
                {nameRow}
              </GameStatsRows>
            ) : (
              nameRow
            )}
            {selected && (
              <div className="w-6 h-6 shrink-0 bg-green-500 rounded-full flex items-center justify-center text-white">
                <Check size={16} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
