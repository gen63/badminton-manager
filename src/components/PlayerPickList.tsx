import { Check } from 'lucide-react';
import type { Player } from '../types/player';

interface PlayerPickListProps {
  players: Player[];
  getPlayerName: (id: string) => string;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}

/**
 * モーダル内のプレイヤー選択リスト。
 * 名前・性別バッジ・休憩中バッジ・選択時のスタイルと、待機中→休憩中の並び替えを担う。
 * `ReservationAddModal` と `PairPreferenceAddModal` の共通部分を切り出したもの。
 * 選択状態の持ち方（Set / 配列）は呼び出し側に委ねるため `isSelected` / `onToggle` を props で受け取る。
 */
export function PlayerPickList({ players, getPlayerName, isSelected, onToggle }: PlayerPickListProps) {
  // 待機中→休憩中の順で表示
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.isResting !== b.isResting) return a.isResting ? 1 : -1;
    return 0;
  });

  return (
    <div className="p-4 flex flex-col gap-2">
      {sortedPlayers.map((player) => {
        const selected = isSelected(player.id);
        const textColor = player.gender === 'M'
          ? 'text-blue-600'
          : player.gender === 'F'
          ? 'text-pink-600'
          : 'text-foreground';

        return (
          <button
            key={player.id}
            onClick={() => onToggle(player.id)}
            className={`relative flex items-center justify-between border-2 p-3 rounded-xl transition-all shadow-sm active:scale-95 ${
              selected
                ? 'bg-green-50 border-green-500'
                : player.isResting
                ? 'bg-muted/30 border-border'
                : 'bg-card border-border'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${player.isResting ? 'text-muted-foreground' : textColor}`}>
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
            </div>
            {selected && (
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white">
                <Check size={16} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
