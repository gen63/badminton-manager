import { useState } from 'react';
import { X, Check } from 'lucide-react';
import type { Player } from '../types/player';

interface ReservationAddModalProps {
  players: Player[];
  getPlayerName: (id: string) => string;
  onConfirm: (playerIds: string[]) => void;
  onCancel: () => void;
}

export function ReservationAddModal({
  players,
  getPlayerName,
  onConfirm,
  onCancel,
}: ReservationAddModalProps) {
  const maxPlayers = 4; // ダブルス専用
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < maxPlayers) {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleConfirm = () => {
    if (selectedIds.size >= 1) {
      onConfirm(Array.from(selectedIds));
    }
  };

  // 待機中→休憩中の順で表示
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.isResting !== b.isResting) return a.isResting ? 1 : -1;
    return 0;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">予約追加</h2>
            <p className="text-xs text-muted-foreground mt-1">
              メンバーを選択 ({selectedIds.size}/{maxPlayers}人)
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-2">
          {sortedPlayers.map((player) => {
            const isSelected = selectedIds.has(player.id);
            const textColor = player.gender === 'M'
              ? 'text-blue-600'
              : player.gender === 'F'
              ? 'text-pink-600'
              : 'text-foreground';

            return (
              <button
                key={player.id}
                onClick={() => handleToggle(player.id)}
                className={`relative flex items-center justify-between border-2 p-3 rounded-xl transition-all shadow-sm active:scale-95 ${
                  isSelected
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
                {isSelected && (
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white">
                    <Check size={16} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-muted text-foreground rounded-xl font-semibold text-sm hover:bg-muted/80 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
