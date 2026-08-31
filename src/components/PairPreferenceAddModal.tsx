import { useState } from 'react';
import { X, Heart } from 'lucide-react';
import type { Player } from '../types/player';
import type { PairPreference } from '../types/pairPreference';
import { PlayerPickList } from './PlayerPickList';

interface PairPreferenceAddModalProps {
  players: Player[];
  existingPreferences: PairPreference[];
  getPlayerName: (id: string) => string;
  onConfirm: (playerIds: [string, string], strength: PairPreference['strength']) => void;
  onCancel: () => void;
}

const MAX_PLAYERS = 2;

/**
 * 選択した2人のどちらかが既に別の `strong` 希望に含まれているか。
 * 含まれていれば、その人の名前を返す（ブロック用）。`normal` 同士の重複は許可する。
 */
function findConflictingStrongMember(
  selectedIds: string[],
  existingPreferences: PairPreference[],
  getPlayerName: (id: string) => string,
): string | null {
  for (const pref of existingPreferences) {
    if (pref.strength !== 'strong') continue;
    for (const id of selectedIds) {
      if (pref.playerIds.includes(id)) {
        return getPlayerName(id);
      }
    }
  }
  return null;
}

/*
 * 【意図的に持たない機能】実力差にもとづく「成立しにくい / 成立しません」の警告
 *
 * かつてこのモーダルは、選んだ2人の順位差から成立見込みを警告していた。**削除済み。**
 * このサークルはメンバーに自身の実力（レート・順位）を公開していないため、
 * 「実力帯が離れています」と出すこと自体が**その2人の実力差を露見させる**。
 * 特定のペアでだけ警告が出れば、試すだけで相対的な序列が推測できてしまう。
 *
 * 成立しにくさは、カードの成立実績（`3/6組`）という**結果**の表示で伝える。
 * こちらは実際の試合を見ていれば分かることなので、新たな情報を漏らさない。
 *
 * 同じ理由で、ここに実力・レート・順位を示唆する表示を再び追加しないこと。
 */

export function PairPreferenceAddModal({
  players,
  existingPreferences,
  getPlayerName,
  onConfirm,
  onCancel,
}: PairPreferenceAddModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [strength, setStrength] = useState<PairPreference['strength']>('normal');

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((pid) => pid !== id);
      if (prev.length >= MAX_PLAYERS) return prev;
      return [...prev, id];
    });
  };

  const conflictName =
    strength === 'strong'
      ? findConflictingStrongMember(selectedIds, existingPreferences, getPlayerName)
      : null;


  const canConfirm = selectedIds.length === 2 && !conflictName;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm([selectedIds[0], selectedIds[1]], strength);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">ペア希望を追加</h2>
              <p className="text-xs text-muted-foreground mt-1">
                メンバーを選択 ({selectedIds.length}/{MAX_PLAYERS}人)
              </p>
            </div>
            <button
              onClick={onCancel}
              aria-label="閉じる"
              className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* 強度トグル */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setStrength('normal')}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                strength === 'normal'
                  ? 'bg-muted border-muted-foreground/40 text-foreground'
                  : 'bg-background border-border text-muted-foreground'
              }`}
            >
              普通
            </button>
            <button
              onClick={() => setStrength('strong')}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors flex items-center justify-center gap-1 ${
                strength === 'strong'
                  ? 'bg-amber-100 border-amber-400 text-amber-700'
                  : 'bg-background border-border text-muted-foreground'
              }`}
            >
              <Heart size={13} />
              必ず
            </button>
          </div>

          {conflictName && (
            <p className="mt-2 text-xs text-destructive">
              {conflictName}さんは既に「必ず」の希望に入っています
            </p>
          )}
        </div>

        {/* Content */}
        <PlayerPickList
          players={players}
          getPlayerName={getPlayerName}
          isSelected={(id) => selectedIds.includes(id)}
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
            disabled={!canConfirm}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
