import { useState } from 'react';
import { X } from 'lucide-react';
import type { Player } from '../types/player';
import { inferDoublesCategory, getCategoryShortLabel } from '../lib/reservationUtils';
import { PlayerPickList } from './PlayerPickList';

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
    if (selectedIds.size >= 2) {
      onConfirm(Array.from(selectedIds));
    }
  };

  const category = inferDoublesCategory(Array.from(selectedIds), players);
  const categoryLabel = getCategoryShortLabel(category);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">予約追加</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-muted-foreground">
                メンバーを選択 ({selectedIds.size}/{maxPlayers}人)
              </p>
              {categoryLabel && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  category === '男子ダブルス'
                    ? 'bg-blue-100 text-blue-700'
                    : category === '女子ダブルス'
                    ? 'bg-pink-100 text-pink-700'
                    : 'bg-purple-100 text-purple-700'
                }`}>
                  {categoryLabel}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="閉じる"
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <PlayerPickList
          players={players}
          getPlayerName={getPlayerName}
          isSelected={(id) => selectedIds.has(id)}
          onToggle={handleToggle}
        />

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
            disabled={selectedIds.size < 2}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
