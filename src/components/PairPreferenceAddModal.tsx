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

type FeasibilityWarning = 'none' | 'sparse' | 'blocked';

/**
 * 順位差のハード制約が効き始める最小人数。`algorithm.ts` の
 * `WIDE_RANK_SPAN_MIN_ROSTER` と同じ値。これ未満のセッションでは制約自体が
 * 無効なので、どんな実力差でも 'blocked' にはならない。
 *
 * `algorithm.ts` から import せず定数を置いているのは、このモーダルが
 * 配置ロジックに依存しない表示専用の目安であるため（値がズレても警告文の
 * 出方が変わるだけで、配置の挙動には影響しない）。
 */
const WIDE_RANK_SPAN_MIN_ROSTER = 14;

/**
 * 実力順位差から成立見込みの警告レベルを求める。
 * rating が未設定/0 のメンバーが1人でもいる場合は順位が意味を持たないため 'none'。
 * plan 2026-08-31-pair-preference.md の UI（予約ページ）節を参照。
 */
function computeFeasibilityWarning(
  playerAId: string,
  playerBId: string,
  players: Player[],
): FeasibilityWarning {
  if (players.some((p) => !p.rating)) return 'none';
  if (players.length === 0) return 'none';

  const ranked = [...players].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const rankOf = (id: string) => ranked.findIndex((p) => p.id === id);
  const rankA = rankOf(playerAId);
  const rankB = rankOf(playerBId);
  if (rankA < 0 || rankB < 0) return 'none';

  const rankDiff = Math.abs(rankA - rankB);
  const groupWidth = Math.ceil(players.length / 3);
  const wideSpanThreshold = Math.ceil((players.length * 2) / 3);

  // 14人未満は順位差のハード制約がオフなので「成立しません」は出さない。
  // 実力帯が離れていること自体は変わらないので 'sparse' の判定は残す。
  if (players.length >= WIDE_RANK_SPAN_MIN_ROSTER && rankDiff >= wideSpanThreshold) {
    return 'blocked';
  }
  if (rankDiff >= groupWidth) return 'sparse';
  return 'none';
}

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

  const feasibility =
    selectedIds.length === 2
      ? computeFeasibilityWarning(selectedIds[0], selectedIds[1], players)
      : 'none';

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
          {!conflictName && feasibility === 'sparse' && (
            <p className="mt-2 text-xs text-amber-700">
              実力帯が離れているため成立しにくいことがあります
            </p>
          )}
          {!conflictName && feasibility === 'blocked' && (
            <p className="mt-2 text-xs text-amber-700">
              実力差が大きく、成立しません
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
