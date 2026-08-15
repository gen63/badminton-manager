import { useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import type { Player } from '../types/player';

export type AssignScope = 'match' | 'all';

interface OrphanPlayerAssignModalProps {
  /** 対象の試合番号（履歴カードの通し番号。表示用） */
  matchNumber: number;
  /** 同じ orphan ID が出場している履歴の試合数 */
  orphanMatchCount: number;
  /** 選択候補（現在の名簿） */
  players: Player[];
  /** その試合に既に出ている ID。二重出場になるので選べない */
  idsInMatch: string[];
  onConfirm: (playerId: string, scope: AssignScope) => void;
  onCancel: () => void;
}

/**
 * 履歴に取り残された「未設定」（削除されたメンバーの ID）を、現在の名簿の誰かに
 * 割り当て直すモーダル。
 *
 * 同じ人が何試合も出ていることが普通なので、既定は「この人の全試合」をまとめて修復する
 * （1試合ずつ直させると取りこぼす）。1件だけ直したいときは範囲を切り替える。
 */
export function OrphanPlayerAssignModal({
  matchNumber,
  orphanMatchCount,
  players,
  idsInMatch,
  onConfirm,
  onCancel,
}: OrphanPlayerAssignModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope, setScope] = useState<AssignScope>('all');

  const inMatch = new Set(idsInMatch);
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const handleConfirm = () => {
    if (selectedId) onConfirm(selectedId, scope);
  };

  const scopeButton = (value: AssignScope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(value)}
      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
        scope === value
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">「未設定」を修復</h2>
            <p className="text-xs text-muted-foreground mt-1">
              試合 {matchNumber} の未設定は、名簿から消えたメンバーです。誰だったか選んでください。
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="閉じる"
            className="w-8 h-8 shrink-0 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          {/* 適用範囲。既定は全試合（同じ人が複数試合に出ているのが普通） */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">適用範囲</p>
            <div className="flex gap-2">
              {scopeButton('all', `この人の全試合（${orphanMatchCount}件）`)}
              {scopeButton('match', 'この試合だけ')}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">割り当てるメンバー</p>
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                名簿にメンバーがいません
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {sorted.map((p) => {
                  const disabled = inMatch.has(p.id);
                  const isSelected = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedId(p.id)}
                      className={`flex items-center justify-between border-2 p-3 rounded-xl transition-all text-left ${
                        isSelected
                          ? 'bg-green-100 border-green-500'
                          : 'bg-card border-border hover:shadow-md active:scale-[0.99]'
                      } disabled:opacity-40 disabled:hover:shadow-none disabled:active:scale-100`}
                    >
                      <span
                        className={`font-semibold text-sm ${
                          p.gender === 'M'
                            ? 'text-blue-600'
                            : p.gender === 'F'
                            ? 'text-pink-600'
                            : 'text-foreground'
                        }`}
                      >
                        {p.name}
                        {disabled && (
                          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                            この試合に出場中
                          </span>
                        )}
                      </span>
                      {isSelected && (
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white shrink-0">
                          <Check size={16} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="flex gap-1.5 text-[11px] text-muted-foreground leading-snug">
            <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            <span>
              名簿にいない人は、先に参加者管理から追加してください。
              試合数・勝率は履歴から自動で計算し直されます。
            </span>
          </p>
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-muted text-foreground rounded-xl font-semibold text-sm hover:bg-muted/80 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            割り当てる
          </button>
        </div>
      </div>
    </div>
  );
}
