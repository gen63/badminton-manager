import { create } from 'zustand';

/**
 * 「未記録試合プロンプト」を「不明」/×で閉じた matchId をセッション中だけ覚える。
 * 同じ試合が新フロー (UnrecordedMatchPrompt) で即再表示されるのを防ぐ用途。
 *
 * - 永続化しない（リロードで消える）。
 * - sessionStore.clearSession でセッション切替時にクリアする。
 * - 試合終了直後の WinnerSelectModal (pendingScoreMatch) を「不明」/×で
 *   閉じたときも、同じ matchId をここに add して新フローで即再表示される
 *   のを抑止する。
 */
interface UnrecordedDismissState {
  dismissed: Set<string>;
  add: (matchId: string) => void;
  clear: () => void;
}

export const useUnrecordedDismissStore = create<UnrecordedDismissState>((set) => ({
  dismissed: new Set(),
  add: (matchId) =>
    set((s) => {
      if (s.dismissed.has(matchId)) return s;
      const next = new Set(s.dismissed);
      next.add(matchId);
      return { dismissed: next };
    }),
  clear: () => set({ dismissed: new Set() }),
}));
