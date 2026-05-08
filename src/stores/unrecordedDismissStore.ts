import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 「不明」/×でスヌーズしたときのデフォルト時間（10 分）。 */
export const UNRECORDED_DISMISS_DURATION_MS = 10 * 60 * 1000;

/**
 * 「未記録試合プロンプト」を「不明」/×で閉じた matchId → スヌーズ期限
 * (Unix ms) のマップ。期限を過ぎると自動で再表示対象に戻る。
 *
 * - localStorage に永続化（リロードしてもスヌーズが維持される）。
 * - sessionStore.clearSession でセッション切替時にクリアする。
 */
interface UnrecordedDismissState {
  /** matchId -> 期限タイムスタンプ (ms)。Date.now() < value の間スヌーズ中。 */
  dismissedUntil: Record<string, number>;
  /** 指定 matchId をスヌーズ。durationMs 省略時はデフォルト 10 分。 */
  dismiss: (matchId: string, durationMs?: number) => void;
  clear: () => void;
}

export const useUnrecordedDismissStore = create<UnrecordedDismissState>()(
  persist(
    (set) => ({
      dismissedUntil: {},
      dismiss: (matchId, durationMs = UNRECORDED_DISMISS_DURATION_MS) =>
        set((s) => {
          const now = Date.now();
          // 期限切れエントリを掃除（無制限な肥大化防止）
          const next: Record<string, number> = {};
          for (const [id, until] of Object.entries(s.dismissedUntil)) {
            if (until > now) next[id] = until;
          }
          next[matchId] = now + durationMs;
          return { dismissedUntil: next };
        }),
      clear: () => set({ dismissedUntil: {} }),
    }),
    { name: 'unrecorded-dismiss' },
  ),
);

/**
 * dismissedUntil から「現時点でスヌーズ中の matchId 集合」を計算する。
 * 純関数。テスト容易性のため now を引数化している。
 */
export function activeDismissedSet(
  dismissedUntil: Record<string, number>,
  now: number,
): Set<string> {
  const set = new Set<string>();
  for (const [id, until] of Object.entries(dismissedUntil)) {
    if (until > now) set.add(id);
  }
  return set;
}
